import { generateObject } from "ai";
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";
import { getAgentModel } from "../../ai/ai.config.ts";

export interface EnrichedDump {
  content: string;
  kind: "text" | "url" | "image";
  title: string;
  tags: string[];
  summary: string;
  source_url?: string;
}

const metaSchema = z.object({
  title: z.string().describe("Short descriptive title, max 10 words"),
  tags: z.array(z.string()).min(1).max(6).describe("Lowercase topic tags"),
  summary: z.string().describe("2-3 sentence summary of the note"),
});

function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s.trim());
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  if (process.env.FIRECRAWL_API_KEY) {
    const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
    const doc = await fc.scrape(url, { formats: ["markdown"] });
    const md = (doc as { markdown?: string }).markdown;
    if (md) return md;
  }
  const r = await fetch(url, { redirect: "follow" });
  return stripHtml(await r.text());
}

async function generateMeta(content: string) {
  const { object } = await generateObject({
    model: getAgentModel(),
    schema: metaSchema,
    prompt: `Generate metadata for this personal knowledge-base note:\n\n${content.slice(0, 12_000)}`,
  });
  return object;
}

/** Text or URL dump → enriched note (image dumps: run vision first, pass kind "image"). */
export async function enrichDump(
  raw: string,
  kind: "text" | "image" = "text",
): Promise<EnrichedDump> {
  const trimmed = raw.trim();

  if (kind === "text" && isUrl(trimmed)) {
    const page = await fetchPage(trimmed);
    const content = page.slice(0, 12_000) || trimmed;
    const meta = await generateMeta(content);
    return { content, kind: "url", source_url: trimmed, ...meta };
  }

  const meta = await generateMeta(trimmed);
  return { content: trimmed, kind, ...meta };
}
