import { sql } from "drizzle-orm";
import type { Database, SqlClient } from "../client.ts";

/** BGE-M3 vectors. Changing the model means emptying the table. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Sets up the vector index over fragments when Postgres has pgvector (the
 * pgvector/pgvector image). Without it, everything else works and this returns false.
 * The index only helps searching: fragments keep their drawer, nature and confidence.
 */
export async function ensureVectorStore(client: SqlClient): Promise<boolean> {
  const [available] = await client<{ n: number }[]>`select count(*)::int as n from pg_available_extensions where name = 'vector'`;
  if (!available?.n) return false;
  await client.unsafe(`create extension if not exists vector`);
  await client.unsafe(`create table if not exists fact_embeddings (
    fact_id uuid primary key references profile_facts(id) on delete cascade,
    model text not null,
    embedding vector(${String(EMBEDDING_DIMENSIONS)}) not null,
    created_at timestamptz not null default now()
  )`);
  await client.unsafe(`create index if not exists fact_embeddings_hnsw_idx on fact_embeddings using hnsw (embedding vector_cosine_ops)`);
  return true;
}

export async function vectorStoreReady(db: Database): Promise<boolean> {
  const [row] = await db.execute<{ ok: boolean }>(sql`select to_regclass('public.fact_embeddings') is not null as ok`);
  return row?.ok ?? false;
}

const literal = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/** Current fragments that have no vector yet. */
export async function factsToEmbed(db: Database, limit: number): Promise<{ id: string; content: string }[]> {
  const rows = await db.execute<{ id: string; content: string }>(sql`
    select f.id, f.content from profile_facts f
    where f.superseded_by is null and f.deleted_at is null
      and not exists (select 1 from fact_embeddings e where e.fact_id = f.id)
    order by f.created_at desc limit ${limit}`);
  return [...rows];
}

export async function saveEmbeddings(db: Database, model: string, rows: { factId: string; vector: number[] }[]): Promise<void> {
  for (const row of rows) {
    if (row.vector.length !== EMBEDDING_DIMENSIONS) continue;
    await db.execute(sql`insert into fact_embeddings (fact_id, model, embedding) values (${row.factId}, ${model}, ${literal(row.vector)}::vector)
      on conflict (fact_id) do update set model = excluded.model, embedding = excluded.embedding, created_at = now()`);
  }
}

export interface SimilarFact {
  id: string;
  ref: string;
  memberId: string;
  memberName: string;
  category: string;
  nature: string;
  confidence: number;
  content: string;
  similarity: number;
}

/** Current fragments closest in meaning to a vector, optionally among some people only. */
export async function similarFacts(db: Database, vector: number[], options: { memberIds?: string[]; limit?: number; min?: number } = {}): Promise<SimilarFact[]> {
  const people = options.memberIds?.length ? sql`and f.member_id in (${sql.join(options.memberIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const rows = await db.execute<SimilarFact & Record<string, unknown>>(sql`
    select f.id, f.ref, f.member_id as "memberId", coalesce(m.display_name, m.username) as "memberName", f.category, f.nature, f.confidence, f.content,
      (1 - (e.embedding <=> ${literal(vector)}::vector))::float8 as similarity
    from fact_embeddings e
    join profile_facts f on f.id = e.fact_id and f.superseded_by is null and f.deleted_at is null
    join members m on m.id = f.member_id
    where true ${people}
    order by e.embedding <=> ${literal(vector)}::vector
    limit ${options.limit ?? 10}`);
  return rows.filter((r) => r.similarity >= (options.min ?? 0.5));
}

/** Pairs of fragments in one dossier that mean nearly the same, for the tidy. */
export async function semanticPairs(db: Database, memberId: string, min = 0.86): Promise<[string, string][]> {
  const rows = await db.execute<{ a: string; b: string }>(sql`
    select a.fact_id as a, b.fact_id as b
    from fact_embeddings a
    join profile_facts fa on fa.id = a.fact_id and fa.member_id = ${memberId} and fa.superseded_by is null and fa.deleted_at is null
    join fact_embeddings b on b.fact_id > a.fact_id
    join profile_facts fb on fb.id = b.fact_id and fb.member_id = ${memberId} and fb.superseded_by is null and fb.deleted_at is null
    where 1 - (a.embedding <=> b.embedding) >= ${min}
    limit 30`);
  return rows.map((r) => [r.a, r.b]);
}
