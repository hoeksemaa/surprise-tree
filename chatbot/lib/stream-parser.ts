import { FollowUp, ParseState } from "./types";

export interface ParserCallbacks {
  onScratchpadStart: () => void;
  onScratchpadEnd: () => void;
  onResponseChunk: (text: string) => void;
  onResponseEnd: () => void;
  onFollowUps: (followUps: FollowUp[]) => void;
}

export class StreamParser {
  private state: ParseState = "idle";
  private buffer = "";
  private callbacks: ParserCallbacks;

  // How much to hold back to avoid emitting partial closing tags
  private static LOOKBACK = 20;

  constructor(callbacks: ParserCallbacks) {
    this.callbacks = callbacks;
  }

  feed(chunk: string) {
    this.buffer += chunk;
    this.process();
  }

  private process() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.state === "idle") {
        const idx = this.buffer.indexOf("<scratchpad>");
        if (idx === -1) break;
        this.buffer = this.buffer.slice(idx + "<scratchpad>".length);
        this.state = "scratchpad";
        this.callbacks.onScratchpadStart();
        continue;
      }

      if (this.state === "scratchpad") {
        const idx = this.buffer.indexOf("</scratchpad>");
        if (idx === -1) break;
        this.buffer = this.buffer.slice(idx + "</scratchpad>".length);
        this.state = "waiting-for-response";
        this.callbacks.onScratchpadEnd();
        continue;
      }

      if (this.state === "waiting-for-response") {
        const idx = this.buffer.indexOf("<response>");
        if (idx === -1) break;
        this.buffer = this.buffer.slice(idx + "<response>".length);
        this.state = "response";
        continue;
      }

      if (this.state === "response") {
        const closeIdx = this.buffer.indexOf("</response>");
        if (closeIdx !== -1) {
          // Emit everything before the closing tag
          const content = this.buffer.slice(0, closeIdx);
          if (content) this.callbacks.onResponseChunk(content);
          this.buffer = this.buffer.slice(closeIdx + "</response>".length);
          this.state = "waiting-for-followups";
          this.callbacks.onResponseEnd();
          continue;
        }
        // Emit what we can, holding back a lookback buffer
        if (this.buffer.length > StreamParser.LOOKBACK) {
          const safe = this.buffer.slice(
            0,
            this.buffer.length - StreamParser.LOOKBACK
          );
          this.callbacks.onResponseChunk(safe);
          this.buffer = this.buffer.slice(safe.length);
        }
        break;
      }

      if (this.state === "waiting-for-followups") {
        const idx = this.buffer.indexOf("<followups>");
        if (idx === -1) break;
        this.buffer = this.buffer.slice(idx + "<followups>".length);
        this.state = "followups";
        continue;
      }

      if (this.state === "followups") {
        const closeIdx = this.buffer.indexOf("</followups>");
        if (closeIdx === -1) break;
        const content = this.buffer.slice(0, closeIdx);
        const followUps = this.parseFollowUps(content);
        this.buffer = this.buffer.slice(closeIdx + "</followups>".length);
        this.state = "done";
        this.callbacks.onFollowUps(followUps);
        break;
      }

      break;
    }
  }

  private parseFollowUps(content: string): FollowUp[] {
    const regex = /<q\s+persona="([^"]+)">([\s\S]*?)<\/q>/g;
    const results: FollowUp[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      results.push({ persona: match[1], question: match[2].trim() });
    }
    return results;
  }

  getState(): ParseState {
    return this.state;
  }
}
