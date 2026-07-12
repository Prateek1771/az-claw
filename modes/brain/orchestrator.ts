import chalk from "chalk";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { select, text, isCancel, spinner } from "@clack/prompts";
import { generateText } from "ai";
import { getAgentModel } from "../../ai/ai.config.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { enrichDump, type EnrichedDump } from "./enrich.ts";
import { embed } from "./embeddings.ts";
import { extractFromImage } from "./vision.ts";
import { brainConfigured, insertNote, matchNotes, type MatchedNote } from "./store.ts";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function embeddingText(n: { title: string; summary: string; content: string }): string {
  return `${n.title}\n${n.summary}\n${n.content}`;
}

export async function saveDump(note: EnrichedDump): Promise<void> {
  const embedding = await embed(embeddingText(note));
  await insertNote({ ...note, embedding });
}

export function notesContext(notes: MatchedNote[]): string {
  return notes
    .map(
      (n, i) =>
        `[Note ${i + 1}] ${n.title ?? "(untitled)"} (${n.kind}, tags: ${n.tags?.join(", ") ?? "-"}, saved ${n.created_at.slice(0, 10)})${n.source_url ? `\nSource: ${n.source_url}` : ""}\n${n.content.slice(0, 2000)}`,
    )
    .join("\n\n---\n\n");
}

export async function answerFromBrain(question: string): Promise<string> {
  const queryVec = await embed(question);
  const notes = await matchNotes(queryVec, 8);
  if (notes.length === 0) return "Your brain is empty — dump something first.";

  const { text: answer } = await generateText({
    model: getAgentModel(),
    system:
      "You answer questions using ONLY the user's saved notes below. " +
      "Cite which note(s) you used. If the notes don't cover the question, " +
      "say you have nothing saved about that — never invent notes.",
    prompt: `Saved notes:\n\n${notesContext(notes)}\n\nQuestion: ${question}`,
  });
  return answer.trim() || "(no answer)";
}

function savedCard(note: EnrichedDump): string {
  return [
    chalk.green("\n✓ Saved to your brain"),
    chalk.bold(`  ${note.title}`),
    chalk.dim(`  ${note.kind} · ${note.tags.join(", ")}`),
    `  ${note.summary}\n`,
  ].join("\n");
}

export async function runBrainMode() {
  console.log(chalk.bold("\n🧠 Brain Mode\n"));

  if (!brainConfigured()) {
    console.log(chalk.yellow("Set INSFORGE_BASE_URL and INSFORGE_ANON_KEY in .env first.\n"));
    return;
  }

  while (true) {
    const action = await select({
      message: "Brain",
      options: [
        { value: "dump", label: "Dump — save a thought, link, or snippet" },
        { value: "image", label: "Dump image — extract & save info from an image" },
        { value: "ask", label: "Ask — query your saved notes" },
        { value: "back", label: "← Back" },
      ],
    });
    if (isCancel(action) || action === "back") return;

    const s = spinner();
    try {
      if (action === "dump") {
        const raw = await text({ message: "What do you want to remember?" });
        if (isCancel(raw) || !raw.trim()) continue;
        s.start("Enriching & saving…");
        const note = await enrichDump(raw);
        await saveDump(note);
        s.stop("Saved");
        console.log(savedCard(note));
      }

      if (action === "image") {
        const p = await text({
          message: "Path to image file",
          validate: (v) => {
            const ext = extname((v ?? "").trim().toLowerCase());
            if (!IMAGE_MIME[ext]) return "Must be a .png/.jpg/.jpeg/.gif/.webp file";
          },
        });
        if (isCancel(p)) continue;
        const path = p.trim().replace(/^["']|["']$/g, "");
        s.start("Reading image with Groq vision…");
        const bytes = readFileSync(path);
        const extracted = await extractFromImage(bytes, IMAGE_MIME[extname(path.toLowerCase())]!);
        s.message("Enriching & saving…");
        const note = await enrichDump(extracted, "image");
        await saveDump(note);
        s.stop("Saved");
        console.log(savedCard(note));
      }

      if (action === "ask") {
        const q = await text({ message: "Ask your brain" });
        if (isCancel(q) || !q.trim()) continue;
        s.start("Searching your notes…");
        const answer = await answerFromBrain(q.trim());
        s.stop("Done");
        console.log("\n" + renderTerminalMarkdown(answer) + "\n");
      }
    } catch (err) {
      s.stop("Failed");
      console.log(chalk.red(`\n${err instanceof Error ? err.message : String(err)}\n`));
    }
  }
}
