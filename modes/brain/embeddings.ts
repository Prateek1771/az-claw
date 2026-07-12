// Both models emit 1536 dims, matching notes.embedding vector(1536).
// NB: vectors from the two models are not comparable — a brain built on one
// should stay on it (re-embed if you switch).
const GEMINI_MODEL = "gemini-embedding-001";
const OPENROUTER_MODEL = "openai/text-embedding-3-small";
const MAX_INPUT = 20_000;

async function embedGemini(text: string): Promise<number[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 1536,
      }),
    },
  );
  if (!r.ok) throw new Error(`Gemini embeddings failed: HTTP ${r.status} ${await r.text()}`);

  const json = (await r.json()) as { embedding?: { values: number[] } };
  const vec = json.embedding?.values;
  if (!vec?.length) throw new Error("Gemini embeddings response had no vector");
  return vec;
}

async function embedOpenRouter(text: string): Promise<number[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in .env");

  const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`Embeddings failed: HTTP ${r.status} ${await r.text()}`);

  const json = (await r.json()) as { data?: { embedding: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!vec?.length) throw new Error("Embeddings response had no vector");
  return vec;
}

/** Gemini free tier first; OpenRouter if no Gemini key or the call fails. */
export async function embed(text: string): Promise<number[]> {
  const input = text.slice(0, MAX_INPUT);
  if (process.env.GEMINI_API_KEY) {
    try {
      return await embedGemini(input);
    } catch (err) {
      console.warn(
        `[brain] Gemini embeddings failed (${err instanceof Error ? err.message : err}); falling back to OpenRouter`,
      );
    }
  }
  return embedOpenRouter(input);
}
