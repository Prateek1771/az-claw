import { createClient } from "@insforge/sdk";

export interface NoteInput {
  content: string;
  kind: "text" | "url" | "image";
  title: string;
  tags: string[];
  summary: string;
  source_url?: string;
  embedding: number[];
}

export interface MatchedNote {
  id: number;
  kind: string;
  title: string | null;
  content: string;
  summary: string | null;
  tags: string[] | null;
  source_url: string | null;
  created_at: string;
  similarity: number;
}

export function brainConfigured(): boolean {
  return !!process.env.INSFORGE_BASE_URL && !!process.env.INSFORGE_ANON_KEY;
}

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (client) return client;
  if (!brainConfigured())
    throw new Error("Set INSFORGE_BASE_URL and INSFORGE_ANON_KEY in .env to use the second brain");
  client = createClient({
    baseUrl: process.env.INSFORGE_BASE_URL!,
    anonKey: process.env.INSFORGE_ANON_KEY!,
  });
  return client;
}

export async function insertNote(note: NoteInput): Promise<void> {
  const { error } = await getClient()
    .database.from("notes")
    .insert({ ...note, embedding: JSON.stringify(note.embedding) });
  if (error) throw new Error(`Failed to save note: ${error.message ?? JSON.stringify(error)}`);
}

export async function matchNotes(embedding: number[], count = 8): Promise<MatchedNote[]> {
  const { data, error } = await getClient()
    .database.rpc("match_notes", {
      query_embedding: JSON.stringify(embedding),
      match_count: count,
    });
  if (error) throw new Error(`Search failed: ${error.message ?? JSON.stringify(error)}`);
  return (data ?? []) as MatchedNote[];
}
