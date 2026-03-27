"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onSubmit: (question: string) => void;
  disabled: boolean;
}

export default function SearchBar({ onSubmit, disabled }: SearchBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-2xl mx-auto">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask a question about medical research..."
        disabled={disabled}
        className="flex-1"
        autoFocus
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        Ask
      </Button>
    </form>
  );
}
