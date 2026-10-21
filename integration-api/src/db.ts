import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";

export type Sql = postgres.Sql;

export function connect(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, { onnotice: () => {} });
}

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
  const dir = new URL("../migrations/", import.meta.url);
  const pending = readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && !applied.has(name))
    .sort();
  for (const name of pending) {
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(new URL(name, dir), "utf8"));
      await tx`insert into schema_migrations (name) values (${name})`;
    });
  }
  return pending;
}
