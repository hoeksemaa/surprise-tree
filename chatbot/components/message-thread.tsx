"use client";

import ResponseMessage from "./response-message";
import FollowUpButtons from "./follow-up-buttons";
import { FollowUp } from "@/lib/types";

interface Turn {
  question: string;
  response: string;
  followUps: FollowUp[];
}

interface MessageThreadProps {
  turns: Turn[];
  streamingResponse: string;
  streamingState: "idle" | "scratchpad" | "response" | "done";
  streamingFollowUps: FollowUp[];
  onFollowUpSelect: (question: string) => void;
  isLoading: boolean;
}

export default function MessageThread({
  turns,
  streamingResponse,
  streamingState,
  streamingFollowUps,
  onFollowUpSelect,
  isLoading,
}: MessageThreadProps) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      {/* Completed turns */}
      {turns.map((turn, i) => (
        <div key={i}>
          <div className="bg-muted/50 rounded-lg p-3 mb-3">
            <p className="text-sm font-medium">{turn.question}</p>
          </div>
          <ResponseMessage content={turn.response} />
          <FollowUpButtons
            followUps={turn.followUps}
            onSelect={onFollowUpSelect}
            disabled={i < turns.length - 1 || isLoading}
          />
        </div>
      ))}

      {/* Currently streaming turn */}
      {isLoading && (
        <div>
          {streamingState === "scratchpad" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
              Analyzing papers...
            </div>
          )}
          {(streamingState === "response" || streamingState === "done") &&
            streamingResponse && (
              <>
                <ResponseMessage content={streamingResponse} />
                {streamingFollowUps.length > 0 && (
                  <FollowUpButtons
                    followUps={streamingFollowUps}
                    onSelect={onFollowUpSelect}
                    disabled={streamingState !== "done"}
                  />
                )}
              </>
            )}
        </div>
      )}
    </div>
  );
}
