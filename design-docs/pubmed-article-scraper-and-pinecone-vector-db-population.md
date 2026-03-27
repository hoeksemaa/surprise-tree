# PubMed Vector Database — Design Doc

## What This Covers

A CLI script that scrapes PubMed articles by topic, embeds them, and stores them in a hosted vector database. This doc covers the population script, vector DB setup, and repo scaffolding (dependencies, env config, gitignore) — no query interface, no chatbot, no frontend.

## Files

- `populate.py` — CLI script that fetches PubMed articles, embeds them, and upserts into Pinecone
- `pyproject.toml` — Project config and dependencies (managed via uv), Python >=3.11
- `.env.example` — Template for required API keys
- `.env` — Local env vars with real API keys (gitignored)
- `.gitignore` — Ignores `.env`, `.venv/`, `__pycache__/`

## Design

### Script Interface

```bash
uv run populate.py --topic "liver biopsies" --count 500
```

Two required flags:
- `--topic` — Search query string for PubMed
- `--count` — Number of articles to fetch and embed

Output: tqdm progress bar over the embedding loop. On completion, print: total fetched, total skipped (no abstract), total embedded, total upserted.

### Search Strategy

Hybrid search (semantic similarity + metadata filtering). The future chatbot needs to combine vector similarity with filters like date range or article type to support branching exploration queries (e.g., "similar to X but only clinical trials from 2020+"). Pinecone supports this natively. The population script just needs to store the metadata correctly — the query layer will use it later.

### What Gets Stored Per Article

**Vector:** Local `all-MiniLM-L6-v2` embedding (384 dims) of `"{title}. {abstract}"` concatenated, via sentence-transformers.

**Metadata (stored alongside vector in Pinecone):**
- `pmid` — PubMed article ID (also used as the Pinecone vector ID for upsert/dedup)
- `title`
- `abstract`
- `authors` — comma-separated string
- `journal`
- `pub_date`
- `doi`
- `mesh_terms` — comma-separated MeSH descriptor strings
- `article_type` — e.g., "Journal Article", "Review", "Clinical Trial"

### Behavior

- **Upsert by PMID** — Running the script twice with overlapping topics won't create duplicates. Existing articles are left untouched; new ones are added.
- **Filter out articles without abstracts** — These are low-value for the chatbot use case. Silently skipped.
- **Skip failures** — If an individual article fails to fetch or embed, log a warning and continue. Don't halt the batch.
- **Progress bar** — tqdm over the embedding loop.

## Implementation

### Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Language | Python | Obvious |
| Package manager | uv | Fast, lockfile, self-contained |
| PubMed API | NCBI E-utilities via Biopython (`Entrez`) | Free, structured XML, returns all metadata |
| Embeddings | `all-MiniLM-L6-v2` via sentence-transformers | Local, free, fast on CPU, 384 dims — good enough for a demo |
| Vector DB | Pinecone (free tier) | Hosted — required bc this will deploy to Vercel (serverless, no local disk). Native upsert + metadata filtering for future hybrid search. |
| Progress bar | tqdm | One-liner |
| CLI parsing | argparse | Two flags, no framework needed |

### Pipeline Steps

1. **Init** — Set `Entrez.email` from `ENTREZ_EMAIL` env var, falling back to `"surprise-tree@example.com"` if unset. Connect to Pinecone; auto-create the `pubmed-articles` index if it doesn't exist (using `create_index` with spec for the free tier serverless environment).
2. **Search PubMed** — `Entrez.esearch()` with the topic string and `retmax=count` to get up to `count` PMIDs in one call.
3. **Fetch articles** — `Entrez.efetch()` the PMID list in batches of 200, `rettype="xml"`. Parse with `Entrez.read()` which returns a list of `PubmedArticle` dicts. If a batch fails to fetch or parse, log a warning and skip it.
4. **Parse metadata** — Extract fields from the Biopython parsed structure. Key paths:
   - `article['MedlineCitation']['PMID']`
   - `article['MedlineCitation']['Article']['ArticleTitle']`
   - `article['MedlineCitation']['Article']['Abstract']['AbstractText']` — space-join list elements without labels (some abstracts are structured `StringElement` objects with `Label` attributes like "BACKGROUND:", "METHODS:" — ignore the labels, just join the text)
   - `article['MedlineCitation']['Article']['AuthorList']` — extract `LastName, Initials` per author, comma-join
   - `article['MedlineCitation']['Article']['Journal']['Title']`
   - `article['MedlineCitation']['Article']['Journal']['JournalIssue']['PubDate']` — extract Year (and Month/Day if present), store as string
   - `article['MedlineCitation']['Article']['ELocationID']` — find the one with `EIdType="doi"` if present
   - `article['MedlineCitation']['MeshHeadingList']` — extract `DescriptorName` strings, comma-join
   - `article['MedlineCitation']['Article']['PublicationTypeList']` — first entry as article_type
   - Any of these may be missing on a given article — default to empty string. The only hard filter is: if `AbstractText` is absent, skip the article entirely.
5. **Filter** — Drop articles with no abstract.
6. **Embed** — Batch embed locally via sentence-transformers `model.encode()`. Group text strings into batches of 100. Concatenate title + abstract per article.
7. **Upsert** — Batch upsert into Pinecone using PMID as vector ID. Attach all metadata. Note: Pinecone has a 40KB metadata limit per vector — full abstracts + metadata should fit comfortably (typical abstract is ~2KB), but truncate abstract to 8000 chars as a safety valve.

### Pinecone Index Config

- **Index name:** `pubmed-articles`
- **Dimensions:** 384 (matches all-MiniLM-L6-v2)
- **Metric:** cosine
- **Cloud/region:** `aws` / `us-east-1` (Pinecone free tier default as of 2025)

### Batching Strategy

- PubMed fetch: batches of 200 articles per `efetch` call (API-friendly)
- Local embeddings: batches of 100 (keeps memory reasonable)
- Pinecone upsert: batches of 100 (Pinecone recommended batch size)

### Error Handling

Minimal — this is a demo, not production software.

- If PubMed search returns fewer results than `--count`, use what's available, log the actual count.
- If an individual article fails XML parsing, skip it.
- If a local embed batch fails, skip it (log warning).
- No retries. No circuit breakers. No exponential backoff.

### Environment Variables

```
PINECONE_API_KEY=pc-...
ENTREZ_EMAIL=your-email@example.com
```

Loaded from `.env` via `python-dotenv`. `ENTREZ_EMAIL` is required by NCBI for E-utilities access — they'll block requests without it. `.env.example` should contain these two keys with placeholder values. The script reads from `.env` at runtime, never hardcodes keys.

### Dependencies

```toml
[project]
name = "surprise-tree"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "biopython",
    "sentence-transformers",
    "pinecone",
    "tqdm",
    "python-dotenv",
]
```

Note: `pinecone` (v5+) is the current package name — not `pinecone-client` (deprecated).

## What This Does NOT Cover

- Query interface / search API
- LLM chatbot integration
- Frontend / UI
- Tree-based exploration / follow-up question generation
- Production concerns (rate limiting, monitoring, auth, scaling)
- Incremental update scheduling
