import { createHash } from "node:crypto";
import type { Sql } from "./db.js";

export type ApiKey = { id: string; name: string; account_ids: number[] };

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function findKey(sql: Sql, key: string): Promise<ApiKey | undefined> {
  const [row] = await sql<ApiKey[]>`
    select id, name, account_ids from api_keys where key_hash = ${hashKey(key)} and revoked_at is null`;
  return row;
}
