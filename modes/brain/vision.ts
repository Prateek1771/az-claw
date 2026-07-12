const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const PROMPT =
  "Extract everything useful from this image for a personal knowledge base: " +
  "transcribe any visible text, then describe what the image shows and list the key facts. " +
  "Be thorough but plain — no preamble.";

export async function extractFromImage(
  bytes: Uint8Array,
  mime: string,
  userContext?: string,
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set in .env (needed for image dumps)");

  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const text = userContext ? `${PROMPT}\n\nUser's note about this image: ${userContext}` : PROMPT;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq vision failed: HTTP ${r.status} ${await r.text()}`);

  const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("Groq vision returned no content");
  return out;
}
