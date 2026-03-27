"use client";

import { useState } from "react";
import { Source } from "@/lib/types";

export default function Bibliography({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="border-t pt-4 mt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? "Hide" : "Show"} Bibliography ({sources.length} sources)
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          {sources
            .sort((a, b) => a.citationNumber - b.citationNumber)
            .map((s) => (
              <div key={s.pmid} className="text-sm">
                <span className="font-semibold text-primary">
                  [{s.citationNumber}]
                </span>{" "}
                <span className="font-medium">{s.title}</span>
                {s.authors && (
                  <span className="text-muted-foreground"> — {s.authors}</span>
                )}
                {s.journal && (
                  <span className="text-muted-foreground italic">
                    . {s.journal}
                  </span>
                )}
                {s.pub_date && (
                  <span className="text-muted-foreground"> ({s.pub_date})</span>
                )}
                {s.doi && (
                  <span className="text-muted-foreground">
                    {" "}
                    DOI:{" "}
                    <a
                      href={`https://doi.org/${s.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      {s.doi}
                    </a>
                  </span>
                )}
                <span className="text-muted-foreground"> PMID: {s.pmid}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
