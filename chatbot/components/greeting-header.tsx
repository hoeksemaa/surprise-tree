"use client";

export default function GreetingHeader({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4">
      <h1 className="text-2xl font-semibold text-center text-foreground mb-2">
        Hello, I am a medical research assistant.
      </h1>
      <p className="text-lg text-muted-foreground text-center">
        What are you curious about today?
      </p>
    </div>
  );
}
