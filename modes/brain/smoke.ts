// Round-trip check: bun modes/brain/smoke.ts  (needs INSFORGE_* in .env + schema.sql applied)
import { embed } from "./embeddings.ts";
import { insertNote, matchNotes, brainConfigured } from "./store.ts";

if (!brainConfigured()) {
  console.log("Set INSFORGE_BASE_URL and INSFORGE_ANON_KEY in .env first.");
  process.exit(1);
}

const marker = `smoke-test ${Date.now()}: bun ships a built-in test runner`;
const embedding = await embed(marker);

await insertNote({
  content: marker,
  kind: "text",
  title: "Smoke test note",
  tags: ["smoke"],
  summary: "Round-trip test note.",
  embedding,
});
console.log("✓ inserted");

const matches = await matchNotes(await embed("what runs tests in bun?"), 3);
console.log("✓ matched", matches.length, "note(s); top:", matches[0]?.title, matches[0]?.similarity);

if (!matches.some((m) => m.content === marker)) throw new Error("inserted note not found in matches");
console.log("✓ round-trip OK — you can delete the smoke note from the dashboard");
