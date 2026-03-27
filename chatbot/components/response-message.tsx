"use client";

import ReactMarkdown from "react-markdown";
import { ReactNode } from "react";

function renderCitations(text: string): ReactNode[] {
  // Split on citation patterns like [1], [23], etc.
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    if (/^\[\d+\]$/.test(part)) {
      return (
        <span
          key={i}
          className="text-xs font-semibold text-primary align-super ml-0.5"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export default function ResponseMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground">
      <ReactMarkdown
        components={{
          p: ({ children }) => {
            // Process text children to style citations
            const processed = processChildren(children);
            return <p>{processed}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function processChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return renderCitations(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{renderCitations(child)}</span>;
      }
      return child;
    });
  }
  return children;
}
