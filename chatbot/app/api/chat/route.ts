import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { SYSTEM_PROMPT, formatSourcesBlock } from "@/lib/prompts";
import { Message, Source, StreamMetadata } from "@/lib/types";

const TOP_K = 12;

function getClients() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.index("pubmed-articles");
  return { openai, index };
}

export async function POST(request: Request) {
  try {
    const { openai, index } = getClients();
    const body = await request.json();
    const {
      question,
      conversationHistory,
      accumulatedSources,
      nextCitationNumber,
    } = body as {
      question: string;
      conversationHistory: Message[];
      accumulatedSources: Source[];
      nextCitationNumber: number;
    };

    // 1. Embed the question
    const embeddingResp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });
    const queryVector = embeddingResp.data[0].embedding;

    // 2. Query Pinecone
    const queryResult = await index.query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
    });

    // 3. Merge new articles with accumulated sources
    const existingPmids = new Set(accumulatedSources.map((s) => s.pmid));
    let nextNum = nextCitationNumber;
    const newSources: Source[] = [];

    for (const match of queryResult.matches) {
      const meta = match.metadata as Record<string, string>;
      const pmid = meta.pmid || match.id;
      if (existingPmids.has(pmid)) continue;

      newSources.push({
        pmid,
        citationNumber: nextNum++,
        title: meta.title || "",
        abstract: meta.abstract || "",
        authors: meta.authors || "",
        journal: meta.journal || "",
        pub_date: meta.pub_date || "",
        doi: meta.doi || "",
      });
    }

    const allSources = [...accumulatedSources, ...newSources];

    // 4. Assemble prompt
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: formatSourcesBlock(allSources) },
      ...conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: question },
    ];

    // 5. Stream response
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 16384,
      stream: true,
    });

    const metadata: StreamMetadata = {
      newSources,
      nextCitationNumber: nextNum,
    };

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        // Write metadata as first line
        controller.enqueue(
          encoder.encode(JSON.stringify(metadata) + "\n")
        );

        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        } catch {
          controller.enqueue(
            encoder.encode("\n\n[Response was interrupted. Please try again.]")
          );
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
