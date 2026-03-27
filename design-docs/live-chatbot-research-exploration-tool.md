# Live Chatbot Research Exploration Tool — Design Doc

## What This Covers

A hosted chatbot-style interface for exploring PubMed research. The user asks a question, the system retrieves relevant papers from the Pinecone vector DB, and an LLM synthesizes a cited response with follow-up questions designed to maximize surprise. This doc covers the core interaction loop, retrieval strategy, response generation pipeline, citation system, persona-driven follow-up generation, frontend layout, tech stack, and deployment architecture. It does not cover the population pipeline (see `pubmed-article-scraper-and-pinecone-vector-db-population.md`), though it documents breaking changes to that pipeline (embedding model switch).

## Files

```
app/
  page.tsx              — ChatPage (main page component, manages all client-side state)
  layout.tsx            — Root layout, fonts, global styles
  api/
    chat/
      route.ts          — POST /api/chat endpoint (embedding, retrieval, prompt assembly, streaming)
components/
  greeting-header.tsx   — Landing greeting, hides after first question
  search-bar.tsx        — Input field for questions, always visible at bottom
  message-thread.tsx    — Renders conversation history (user questions + assistant responses)
  response-message.tsx  — Single assistant response with react-markdown rendering + styled [N] citations
  follow-up-buttons.tsx — 4 persona question slots + 1 custom input, stacked vertically
  bibliography.tsx      — Expandable global bibliography at page bottom
lib/
  prompts.ts            — System prompt string and source block formatting utilities
  stream-parser.ts      — State machine for parsing streaming XML tags (scratchpad/response/followups)
  types.ts              — Shared TypeScript types (Source, Message, FollowUp, etc.)
```

## Design

### Landing Page

A single-page app with a centered greeting and search bar. No suggested topics, no sidebar, no settings.

Greeting copy: "Hello, I am a medical research assistant. What are you curious about today?"

### Core Interaction Loop

1. User submits a question (via search bar, follow-up button, or custom input)
2. System retrieves top N papers from Pinecone by embedding similarity to the **latest question only**
3. Retrieved papers are added to an accumulating source context (deduplicated by PMID)
4. The full prompt is assembled: system prompt + all accumulated sources + full conversation history + new question
5. Three-stage LLM generation:
   - **Stage 1 — Scratchpad** (hidden from user): ~10 paragraph analysis summarizing claims across all available papers, flagging consensus, disagreements, outliers, and gaps
   - **Stage 2 — Response** (shown to user): 2-paragraph cited synthesis with inline numbered references
   - **Stage 3 — Follow-ups** (shown to user): 4 persona-driven questions + 1 custom input slot
6. User picks a follow-up or types a custom question → goto 1

Follow-up questions and custom user questions are functionally identical — both enter the same pipeline as the next question in the research chain.

### Retrieval

- **Source:** Pinecone index `pubmed-articles` (populated by the separate population script)
- **Corpus:** Currently populated with liver biopsy research (~1k articles). Future intent is to expand to all medtech research topics. The chatbot's usefulness is bounded by what's in the index — questions outside the indexed topic space will get low-quality matches and the model will acknowledge insufficient sources.
- **Method:** Embedding similarity search. The latest user question is embedded and used to query Pinecone for the top N most similar articles.
- **N:** Fixed at 30 papers per query.
- **Accumulation:** Retrieved papers accumulate across turns. If turn 1 retrieves 30 papers and turn 2 retrieves 30 papers with 5 overlapping, the model sees ~55 unique papers on turn 2. Papers are deduplicated by PMID. Previously retrieved papers are never dropped from context.
- **No similarity threshold:** Always return top N results regardless of similarity score. If the query is outside the indexed topic space, the model is instructed to acknowledge insufficient sources rather than speculate (see system prompt).

### Prompt Structure

The prompt is assembled as an OpenAI chat completions message array:

```typescript
messages: [
  // System prompt (role, personas, generation instructions, citation rules)
  { role: "system", content: systemPrompt },

  // Accumulated sources as a standalone user message
  { role: "user", content: "<sources>\n[1] Title | Authors | Journal | Date | PMID | DOI\nAbstract text...\n\n[2] ...\n</sources>" },

  // Conversation history — alternating user/assistant messages
  { role: "user", content: "first user question" },
  { role: "assistant", content: "<response>first response</response>\n<followups>...</followups>" },

  { role: "user", content: "second user question" },
  { role: "assistant", content: "<response>second response</response>\n<followups>...</followups>" },

  // Latest question
  { role: "user", content: "latest question" },
]
```

Key details:
- The sources block is a dedicated `user` message after the system prompt, updated each turn with all accumulated papers
- Assistant messages in history include `<response>` and `<followups>` XML but NOT `<scratchpad>` (discarded after each turn)
- The sources `user` message is always re-sent in full — it grows as papers accumulate across turns
- The user never sees the sources block or the XML structure — only the parsed response and follow-ups

### Three-Stage Generation

All three stages operate on the same context (accumulated sources + conversation history) and are produced in a single model interaction.

**Stage 1 — Scratchpad (hidden)**

The model reads all available papers and produces an internal analysis of approximately 10 paragraphs. This analysis:
- Summarizes the key claims made across papers
- Identifies where papers agree (consensus)
- Identifies where papers disagree (contradictions, outliers)
- Notes gaps — topics or populations where evidence is thin or absent
- Flags anything that goes against the grain of majority findings

This scratchpad is not shown to the user. Its purpose is to give the model a structured understanding of the literature landscape before generating the user-facing response and follow-ups.

**Stage 2 — Response (shown)**

A 2-paragraph synthesis answering the user's question, grounded in the retrieved papers. Every factual claim must have an inline numbered citation. The cited paper must actually support the specific claim being made — citation faithfulness is a hard constraint.

**Stage 3 — Follow-ups (shown)**

Four questions, one per persona (see below), plus a custom input slot. Each question is generated by asking: "If I were this persona, what would I find most surprising about the data, and what short question would I want to ask next?"

The follow-up questions should be informed by the scratchpad — especially outliers, contradictions, and gaps identified in Stage 1.

### Personas

Four personas drive follow-up question generation. Each has a one-paragraph summary embedded in the system prompt defining who they are, their goals, and their problems.

**1. Business & Regulatory Reviewer**

A non-technical researcher working in a corporate or regulatory context. They care about market implications, FDA and EMA approval pathways, adoption barriers, cost-effectiveness analyses, and competitive landscape. Their goal is to understand how research findings translate into commercial or regulatory outcomes. Their problem is that they lack the technical depth to evaluate methodology directly, so they rely on consensus signals and are especially interested when findings might disrupt existing market assumptions or regulatory precedents.

**2. Domain Expert**

A senior researcher or specialist deeply familiar with the field in question. They want to drill into technical details — mechanisms of action, study methodology, sample sizes, statistical approaches, confounders, and reproducibility. Their goal is to evaluate the rigor of findings and identify where the science is strong versus weak. Their problem is that they may be too close to prevailing paradigms in their field, so they benefit from having outlier findings and methodological critiques surfaced explicitly.

**3. Clinician / Practitioner**

A practicing medical professional who sees patients. They care about practical applicability — patient outcomes, side effect profiles, treatment protocols, clinical guidelines, and workflow integration. Their goal is to understand how research findings change (or should change) what they do in practice. Their problem is time — they can't read every paper, so they need high-signal summaries of what matters for patient care, especially when new findings contradict current standard of care.

**4. Adjacent-Field Connector**

A researcher or professional from a related but different discipline. They draw links across specialties, technologies, or biological systems that domain insiders might miss. Their goal is to spot transferable techniques, cross-domain patterns, or unexpected overlaps. Their problem is that they lack deep context in the specific field, so they benefit from clear explanations that highlight what's structurally novel versus routine within the domain.

### Citation System

**Inline citations:** Numbered references in square brackets within the response text, e.g., "Treatment A showed 6-month recovery times [3], though one study reported significantly faster outcomes [7]."

**Global bibliography:** A single bibliography at the bottom of the page that grows over the session. Each paper appears exactly once, with a stable number — if a paper is assigned [3] in the first response, it remains [3] for the entire session. New papers get the next available number.

**Bibliography entries** include: number, title, authors, journal, publication date, PMID, and DOI (linked where available).

**Expandable UI:** The bibliography is collapsed by default and can be expanded by the user to browse all sources accumulated during the session.

**Faithfulness constraint:** A cited paper must actually claim what the sentence says it claims. This is enforced via prompting — the system prompt explicitly instructs the model to only cite a paper for a claim if the paper's abstract directly supports that specific claim.

### Follow-Up UI

Below each response, five full-width slots stacked vertically:
- Slots 1-4: persona-generated follow-up questions. Each slot shows a muted/ghost persona label above the question text (e.g., "Business & Regulatory", "Domain Expert", "Clinician", "Adjacent Field"). Questions are capped at one sentence.
- Slot 5: a text input field with placeholder text "Ask your own question..."

All five options feed into the same pipeline. There is no behavioral difference between clicking a generated follow-up and submitting a custom question.

### Conversation Memory

Full conversation history is preserved and fed to the model on every turn. This includes all prior user questions and assistant responses (response text + follow-up questions, but NOT the scratchpad — it is discarded after each turn and regenerated fresh from the accumulated sources). Combined with the accumulating sources context, the model never loses information over the course of a session.

There is no cross-session memory. Refreshing the page or starting a new session begins from scratch.

### Target Audience

Medical professionals — researchers, clinicians, and med tech professionals who expect factual accuracy and proper sourcing. The tone should be professional but accessible. The system should feel like a knowledgeable research assistant, not a search engine.

The demo target is the CEO of a small startup that builds software products for medtech companies. The tool should feel immediately relevant to their world — a product their customers would use.

### Visual Design

Light mode, clean, simple. Use shadcn/ui's default light theme with a small amount of accent color (e.g., a single brand color for citations, follow-up button borders, and the greeting). No dark mode. Aim for a clinical-but-modern feel — think medical journal meets modern SaaS. White backgrounds, good typography, generous whitespace. Don't over-design.

## Implementation

### Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js (app router) | Vercel-native, handles frontend + backend in one project |
| Frontend | React (via Next.js) + shadcn/ui | Polished components fast, minimal custom CSS |
| Styling | Tailwind CSS | Comes with Next.js + shadcn, utility-first |
| Backend | Next.js API routes (serverless) | No separate server, deploys as Vercel serverless functions |
| LLM | GPT-4o via OpenAI API | Generation for scratchpad, response, and follow-ups |
| Query-time embedding | OpenAI `text-embedding-3-small` (1536 dims) | Can't load local models in serverless; matches population embeddings |
| Vector DB | Pinecone | Already in use, hosted, serverless-compatible |
| Streaming | Manual fetch + ReadableStream | Custom stream handling needed for XML-structured output with scratchpad stripping. `openai` SDK used directly for both chat completions (streaming) and embeddings. |
| Conversation state | Client-side React state | Serverless = no server sessions |
| Hosting | Vercel (free tier) | Target deployment platform |

### Breaking Change: Embedding Model Switch

The population script (`populate.py`) currently uses local `all-MiniLM-L6-v2` (384 dims). The chatbot needs API-based embeddings for serverless compatibility. You cannot mix embedding models — vectors must be in the same space.

**Required migration:**
1. Update `populate.py` to use OpenAI `text-embedding-3-small` (1536 dims) instead of local sentence-transformers
2. Delete and recreate the `pubmed-articles` Pinecone index with 1536 dimensions (old 384-dim vectors are useless)
3. Re-run population to embed all articles with the new model
4. Add `OPENAI_API_KEY` to `.env` and `.env.example`

This is a one-time migration. After this, both population and query-time use the same OpenAI embedding model.

### Serverless Constraints & Mitigations

**10-second function timeout (Vercel free tier):**
- The three-stage generation (scratchpad + response + follow-ups) with 30 papers in context could take 20-40s total
- **Mitigation:** Stream the response. Vercel streaming keeps the function alive as long as it's actively sending data — the 10s timeout applies to time-to-first-byte, not total duration
- All three stages must be a **single LLM call** with structured output sections, not three sequential API calls

**No persistent state:**
- Conversation history, accumulated sources, and bibliography numbering all live in client-side React state
- Each API request from the frontend includes everything the server needs: the user's question and the list of already-seen PMIDs (so the server can merge new retrievals with existing ones)
- **Context growth bounds:** With a fixed corpus of ~1k articles and 30 papers/query with overlap, a realistic demo session of 3-5 turns accumulates ~60-100 unique papers. This comfortably fits within GPT-4o's 128k context window. Longer sessions (8+ turns) may approach context limits and degrade — acceptable for a demo.

**No local model loading:**
- Embedding must be API-based (OpenAI), not local sentence-transformers
- Cold start with a model file would add 2-5s latency, unacceptable for a demo

### API Route Design

One primary API route handles the core loop:

**`POST /api/chat`**

Request body:
```json
{
  "question": "user's question text",
  "conversationHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "accumulatedSources": [
    { "pmid": "12345", "citationNumber": 1, "title": "...", "abstract": "...", "authors": "...", "journal": "...", "pub_date": "...", "doi": "..." }
  ],
  "nextCitationNumber": 7
}
```

Server-side steps:
1. Embed the question via OpenAI `text-embedding-3-small`
2. Query Pinecone for top 30 similar articles (N is hardcoded server-side)
3. Merge new articles with `accumulatedSources`, dedup by PMID, assign citation numbers starting from `nextCitationNumber`
4. Assemble the full prompt (system + sources + conversation history + new question)
5. Stream the GPT-4o response back (scratchpad + response + follow-ups in one call)

Response uses a **manual `fetch` + `ReadableStream` approach** — NOT the Vercel AI SDK's `useChat` hook. `useChat` assumes standard chat message semantics and doesn't accommodate the XML-structured output with scratchpad stripping and custom metadata. Instead:

**Server side:** The API route uses the `openai` SDK directly to call `chat.completions.create({ stream: true })`. Before starting the LLM stream, it writes a JSON metadata line (newline-delimited) containing the updated sources list, then pipes the LLM stream chunks as subsequent lines. The response is a standard `ReadableStream` with `Content-Type: text/event-stream`.

**Client side:** The frontend calls `fetch('/api/chat', ...)` and reads the response via `getReader()`. It:
1. Reads the first line as JSON metadata — parses the updated sources list, updates `accumulatedSources` and `nextCitationNumber` state, adds new entries to the bibliography
2. Feeds subsequent chunks into the streaming XML parser (see Streaming XML Parser section)

**Stream parsing behavior:**
- While inside `<scratchpad>`: show a loading indicator ("Reading 30 papers...") — do not render scratchpad content
- While inside `<response>`: stream content to the user in real-time, rendering markdown with styled `[N]` citation text (user matches numbers visually to bibliography)
- While inside `<followups>`: parse `<q>` tags into follow-up button slots once complete

**Follow-up button behavior:** Only the most recent set of follow-up buttons is interactive. Previous turns' follow-ups are rendered but visually disabled (grayed out, non-clickable).

### Citation Number Assignment Flow

Citation numbers are assigned server-side before the LLM call, ensuring the model's `[N]` references match the bibliography:

1. Frontend sends request with `accumulatedSources` (already-numbered) + `nextCitationNumber`
2. Server retrieves top N from Pinecone (`top_k=N`, `include_metadata=true`, default namespace, no metadata filters)
3. Server dedupes retrieved papers against existing PMIDs, assigns sequential numbers to new papers starting at `nextCitationNumber`
4. Server builds the `<sources>` block with all papers (old + new), numbered — these numbers appear in the prompt
5. Server writes the new papers and their assigned numbers as a JSON metadata line at the start of the response stream
6. Server calls GPT-4o with the numbered sources in the prompt — model naturally uses these exact numbers in `[N]` citations
7. Frontend reads the first line of the stream as JSON metadata, updates `accumulatedSources` and `nextCitationNumber` state

### Frontend Architecture

**Single page, three states:**

1. **Landing** — greeting message centered on screen, search bar below it
2. **Loading** — search bar disabled, "Reading 30 papers..." indicator while scratchpad generates, then streaming response appearing in chat area
3. **Chat** — conversation thread with responses, inline citations, follow-up buttons below each response, bibliography at bottom

**Client-side state:**
- `conversationHistory`: array of user/assistant message pairs
- `accumulatedSources`: array of all unique papers seen, each with a stable citation number
- `nextCitationNumber`: counter for assigning numbers to newly retrieved papers
**Component breakdown (keep it simple):**
- `ChatPage` — main page component, manages state
- `GreetingHeader` — the landing greeting, hides after first question
- `SearchBar` — input field for questions, always visible at bottom (sticky)
- `MessageThread` — renders conversation history
- `ResponseMessage` — single assistant response with parsed markdown (via `react-markdown`) + styled `[N]` citation text (custom component override: regex-match `\[\d+\]` patterns, render as styled spans — e.g., superscript or bold — no click/scroll behavior)
- `FollowUpButtons` — 5 slots below each response (4 generated + 1 custom input)
- `Bibliography` — expandable section at page bottom, renders all accumulated sources

### Prompt Engineering

The system prompt instructs GPT-4o to produce output in three clearly delimited sections:

```
<scratchpad>
[~10 paragraph internal analysis — consensus, contradictions, outliers, gaps]
</scratchpad>

<response>
[2-paragraph cited synthesis with [N] inline references]
</response>

<followups>
<q persona="business">Question text here?</q>
<q persona="expert">Question text here?</q>
<q persona="clinician">Question text here?</q>
<q persona="connector">Question text here?</q>
</followups>
```

The frontend parses this structure:
- `<scratchpad>` content is discarded (never rendered)
- `<response>` content is rendered as markdown with styled citations
- `<followups>` are parsed into the 4 persona buttons

### Streaming XML Parser

XML tags will arrive split across stream chunks (e.g., `<resp` in one chunk, `onse>` in the next). The frontend implements a simple state machine to handle this:

**States:** `idle` → `scratchpad` → `response` → `followups` → `done`

**Logic:**
1. Maintain a `buffer` string and a `currentState` enum
2. On each incoming chunk, append to buffer
3. Check buffer for tag boundaries:
   - If `currentState` is `idle` and buffer contains `<scratchpad>`: transition to `scratchpad`, clear buffer up to the tag
   - If `currentState` is `scratchpad` and buffer contains `</scratchpad>`: transition to waiting-for-response
   - If buffer contains `<response>`: transition to `response`, start rendering buffered content after the tag
   - If `currentState` is `response` and buffer contains `</response>`: transition to waiting-for-followups, flush remaining content
   - If buffer contains `<followups>`: transition to `followups`
   - If `currentState` is `followups` and buffer contains `</followups>`: parse all `<q>` tags from the buffered followups content, transition to `done`
4. While in `response` state, emit buffered content (everything before potential partial closing tags) to the rendered output incrementally

The parser is conservative: it only emits content it's confident is complete (no partial tags). Content in `response` state is streamed to the user as it arrives, with a small lookback buffer held to avoid emitting a partial `</response>` tag as visible text.

This lives in `lib/stream-parser.ts` — a pure function, no React dependency, easy to unit test.

### Full System Prompt

```
You are a medical research assistant. Your role is to help medical professionals explore PubMed research by synthesizing findings from provided source articles and surfacing surprising or underexplored aspects of the literature.

## How to respond

You will be given a set of numbered source articles and a user question. Produce your response in exactly three sections, in this order:

### Section 1: Scratchpad (hidden from user)

Wrap this section in <scratchpad> tags. Analyze ALL provided source articles systematically:

1. List the key claims made across articles, noting which article numbers support each claim
2. Identify consensus — where do multiple articles agree?
3. Identify contradictions — where do articles disagree on methods, outcomes, or conclusions?
4. Identify outliers — any article whose findings go against the majority
5. Identify gaps — what populations, methods, or questions are underrepresented in the available literature?
6. Note anything that would be unexpected to a domain expert

Be thorough. This analysis directly informs the quality of your response and follow-up questions.

### Section 2: Response (shown to user)

Wrap this section in <response> tags. Write exactly 2 paragraphs synthesizing an answer to the user's question.

Rules:
- Every factual claim MUST have an inline citation in [N] format, where N matches the source number
- ONLY cite a source for a claim if that source's abstract directly supports the specific claim you are making. Do not cite a source for a claim it does not make. This is a hard rule — violating it destroys user trust.
- If multiple sources support the same claim, cite all of them: [3][7][12]
- Write for medical professionals — assume domain literacy, avoid oversimplification
- Be direct and information-dense. No filler.
- If the available sources do not adequately address the user's question, say so explicitly rather than speculating beyond what the sources support.

### Section 3: Follow-up questions (shown to user)

Wrap this section in <followups> tags. Generate exactly 4 follow-up questions, one per persona. Each question must be a single sentence. Use this format:

<q persona="business">Question text?</q>
<q persona="expert">Question text?</q>
<q persona="clinician">Question text?</q>
<q persona="connector">Question text?</q>

Each question should be designed to maximize the chance of surprising the user or leading them to an unexplored area of the research.

Generate each question by adopting the persona below and asking: "Given what I just learned from the scratchpad analysis — especially any contradictions, outliers, or gaps — what would I find most surprising, and what short question would I want to ask next?"

## Personas

**Business & Regulatory Reviewer:** A non-technical researcher in a corporate or regulatory context. Cares about market implications, FDA/EMA approval pathways, adoption barriers, cost-effectiveness, and competitive landscape. Goal: understand how findings translate into commercial or regulatory outcomes. Problem: lacks technical depth to evaluate methodology, relies on consensus signals, especially interested when findings disrupt market assumptions or regulatory precedents.

**Domain Expert:** A senior researcher or specialist deeply familiar with the field. Wants technical details — mechanisms of action, methodology, sample sizes, statistical approaches, confounders, reproducibility. Goal: evaluate rigor, identify where science is strong vs. weak. Problem: may be too close to prevailing paradigms, benefits from outlier findings and methodological critiques surfaced explicitly.

**Clinician / Practitioner:** A practicing medical professional who sees patients. Cares about practical applicability — patient outcomes, side effects, treatment protocols, guidelines, workflow integration. Goal: understand how findings change what they do in practice. Problem: time-constrained, needs high-signal summaries, especially when new findings contradict current standard of care.

**Adjacent-Field Connector:** A researcher from a related but different discipline. Draws links across specialties, technologies, or biological systems that insiders might miss. Goal: spot transferable techniques, cross-domain patterns, unexpected overlaps. Problem: lacks deep context in this specific field, benefits from explanations highlighting what's structurally novel vs. routine.

## Important

- Do not invent information. Every claim must trace back to a provided source.
- Do not use knowledge from your training data to make factual claims about medical research. You may use general knowledge to structure your response, but all medical facts must come from the sources.
- If sources are insufficient to answer the question, say so.
```

### Environment Variables (Vercel)

```
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pc-...
```

Set in Vercel dashboard (Settings → Environment Variables). Never in client-side code, never committed to repo.

### Dependencies (Node)

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "@pinecone-database/pinecone": "^4",
    "openai": "^4",
    "react-markdown": "^9"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^22",
    "@types/react": "^19",
    "tailwindcss": "^4",
    "postcss": "^8",
    "autoprefixer": "^10"
  }
}
```

Plus shadcn/ui components added via CLI (`npx shadcn-ui@latest add button input card`).

Note: `openai` SDK is used directly for both chat completions (streaming) and embeddings. No Vercel AI SDK — the XML-structured output requires custom stream handling that `useChat` doesn't accommodate.

### Error Handling

Minimal — this is a demo. But the user should never see a blank screen.

- **OpenAI API failure (embedding or chat):** Show an inline error message in the chat area: "Something went wrong. Please try again." with a retry button.
- **Pinecone failure:** Same error message. No distinction surfaced to the user.
- **Stream dies mid-response:** Render whatever content was received so far, append an error notice: "Response was interrupted. Please try again."
- **No error toasts, no error codes, no retry logic.** Just a visible message and a manual retry option.

## What This Does NOT Cover

- Population pipeline mechanics (covered by existing design doc; only the embedding switch is documented here)
- Authentication or multi-user support
- Cross-session persistence or user accounts
- Production concerns (rate limiting, monitoring, scaling)
- Tree/graph visualization of exploration paths
