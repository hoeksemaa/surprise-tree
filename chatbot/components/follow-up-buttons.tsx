"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FollowUp } from "@/lib/types";

const PERSONA_LABELS: Record<string, string> = {
  business: "Business & Regulatory",
  expert: "Domain Expert",
  clinician: "Clinician",
  connector: "Adjacent Field",
};

interface FollowUpButtonsProps {
  followUps: FollowUp[];
  onSelect: (question: string) => void;
  disabled: boolean;
}

export default function FollowUpButtons({
  followUps,
  onSelect,
  disabled,
}: FollowUpButtonsProps) {
  const [customValue, setCustomValue] = useState("");

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customValue.trim();
    if (!trimmed || disabled) return;
    onSelect(trimmed);
    setCustomValue("");
  };

  return (
    <div className="flex flex-col gap-2 w-full mt-4">
      {followUps.map((fu, i) => (
        <button
          key={i}
          onClick={() => !disabled && onSelect(fu.question)}
          disabled={disabled}
          className={`text-left p-3 rounded-lg border transition-colors ${
            disabled
              ? "border-muted bg-muted/30 text-muted-foreground cursor-default"
              : "border-border bg-card hover:bg-accent hover:border-primary/30 cursor-pointer"
          }`}
        >
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {PERSONA_LABELS[fu.persona] || fu.persona}
          </span>
          <p className="text-sm mt-1">{fu.question}</p>
        </button>
      ))}
      <form onSubmit={handleCustomSubmit} className="flex gap-2">
        <Input
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder="Ask your own question..."
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !customValue.trim()}
        >
          Ask
        </Button>
      </form>
    </div>
  );
}
