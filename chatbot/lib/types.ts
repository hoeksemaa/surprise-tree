export interface Source {
  pmid: string;
  citationNumber: number;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  pub_date: string;
  doi: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface FollowUp {
  persona: string;
  question: string;
}

export interface StreamMetadata {
  newSources: Source[];
  nextCitationNumber: number;
}

export type ParseState =
  | "idle"
  | "scratchpad"
  | "waiting-for-response"
  | "response"
  | "waiting-for-followups"
  | "followups"
  | "done";
