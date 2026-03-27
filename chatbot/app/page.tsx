"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import GreetingHeader from "@/components/greeting-header";
import SearchBar from "@/components/search-bar";
import MessageThread from "@/components/message-thread";
import Bibliography from "@/components/bibliography";
import { StreamParser } from "@/lib/stream-parser";
import { Source, Message, FollowUp, StreamMetadata } from "@/lib/types";

interface Turn {
  question: string;
  response: string;
  followUps: FollowUp[];
}

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [accumulatedSources, setAccumulatedSources] = useState<Source[]>([]);
  const [nextCitationNumber, setNextCitationNumber] = useState(1);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Streaming state
  const [streamingResponse, setStreamingResponse] = useState("");
  const [streamingState, setStreamingState] = useState<
    "idle" | "scratchpad" | "response" | "done"
  >("idle");
  const [streamingFollowUps, setStreamingFollowUps] = useState<FollowUp[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  const hasStarted = turns.length > 0 || isLoading;

  // Auto-scroll as content streams in
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingResponse, streamingState, turns, streamingFollowUps]);

  const handleSubmit = useCallback(
    async (question: string) => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);
      setStreamingResponse("");
      setStreamingState("idle");
      setStreamingFollowUps([]);
      setCurrentQuestion(question);

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversationHistory,
            accumulatedSources,
            nextCitationNumber,
          }),
        });

        if (!resp.ok) {
          throw new Error("Request failed");
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let firstLine = true;
        let leftover = "";
        let fullResponse = "";
        let finalFollowUps: FollowUp[] = [];
        // Track sources updates for use after stream completes
        let updatedSources = accumulatedSources;
        let updatedNextNum = nextCitationNumber;

        const parser = new StreamParser({
          onScratchpadStart: () => setStreamingState("scratchpad"),
          onScratchpadEnd: () => {},
          onResponseChunk: (text) => {
            fullResponse += text;
            setStreamingResponse(fullResponse);
            setStreamingState("response");
          },
          onResponseEnd: () => {},
          onFollowUps: (fus) => {
            finalFollowUps = fus;
            setStreamingFollowUps(fus);
            setStreamingState("done");
          },
        });

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });

          if (firstLine) {
            leftover += text;
            const newlineIdx = leftover.indexOf("\n");
            if (newlineIdx !== -1) {
              const metaLine = leftover.slice(0, newlineIdx);
              const rest = leftover.slice(newlineIdx + 1);
              firstLine = false;
              leftover = "";

              const metadata: StreamMetadata = JSON.parse(metaLine);
              updatedSources = [
                ...accumulatedSources,
                ...metadata.newSources,
              ];
              updatedNextNum = metadata.nextCitationNumber;
              setAccumulatedSources(updatedSources);
              setNextCitationNumber(updatedNextNum);

              if (rest) parser.feed(rest);
            }
          } else {
            parser.feed(text);
          }
        }

        // Finalize the turn
        const newTurn: Turn = {
          question,
          response: fullResponse,
          followUps: finalFollowUps,
        };

        // Build the assistant content that gets stored in history
        // (response + followups XML, no scratchpad)
        const followUpsXml = finalFollowUps
          .map((f) => `<q persona="${f.persona}">${f.question}</q>`)
          .join("\n");
        const assistantContent = `<response>${fullResponse}</response>\n<followups>\n${followUpsXml}\n</followups>`;

        setTurns((prev) => [...prev, newTurn]);
        setConversationHistory((prev) => [
          ...prev,
          { role: "user", content: question },
          { role: "assistant", content: assistantContent },
        ]);
        setStreamingResponse("");
        setStreamingState("idle");
        setStreamingFollowUps([]);
        setCurrentQuestion("");
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, conversationHistory, accumulatedSources, nextCitationNumber]
  );

  return (
    <div className="flex flex-col h-screen">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <GreetingHeader visible={!hasStarted} />

        {hasStarted && (
          <>
            {/* Show the current question if streaming hasn't started yet */}
            {isLoading && currentQuestion && turns.length === 0 && streamingState === "idle" && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-muted/50 rounded-lg p-3 mb-3">
                  <p className="text-sm font-medium">{currentQuestion}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                  Connecting...
                </div>
              </div>
            )}

            <MessageThread
              turns={turns}
              streamingResponse={streamingResponse}
              streamingState={streamingState}
              streamingFollowUps={streamingFollowUps}
              onFollowUpSelect={handleSubmit}
              isLoading={isLoading}
            />

            {error && (
              <div className="max-w-2xl mx-auto mt-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <Bibliography sources={accumulatedSources} />
          </>
        )}
      </div>

      <div className="sticky bottom-0 bg-background border-t px-4 py-3">
        <SearchBar onSubmit={handleSubmit} disabled={isLoading} />
      </div>
    </div>
  );
}
