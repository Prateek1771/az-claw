-- Second Brain — run once in the InsForge dashboard SQL editor.

create extension if not exists vector;

create table if not exists notes (
  id bigserial primary key,
  content text not null,        -- original dump text / URL page content / vision extraction
  kind text not null default 'text',  -- 'text' | 'url' | 'image'
  title text,
  tags text[],
  summary text,
  source_url text,
  created_at timestamptz not null default now(),
  embedding vector(1536)
);

create or replace function match_notes(
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  id bigint,
  kind text,
  title text,
  content text,
  summary text,
  tags text[],
  source_url text,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select id, kind, title, content, summary, tags, source_url, created_at,
         1 - (embedding <=> query_embedding) as similarity
  from notes
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

create index if not exists notes_embedding_idx
  on notes using hnsw (embedding vector_cosine_ops);
