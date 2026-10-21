import { serve } from "@hono/node-server";
import { createApp } from "../src/api.js";
import { hashKey } from "../src/auth.js";
import { connect, migrate } from "../src/db.js";
import { startLocalPostgres } from "./local-postgres.js";

const DEV_KEY = "pxk_local_dev";

async function localDatabase() {
  const local = await startLocalPostgres(".pgdata", 54329);
  process.on("SIGINT", () => local.stop().then(() => process.exit(0)));
  return local.url;
}

const usesLocalDatabase = !process.env.DATABASE_URL;
const sql = connect(process.env.DATABASE_URL ?? (await localDatabase()));
await migrate(sql);
if (usesLocalDatabase) {
  await sql`
    insert into api_keys (name, key_hash, account_ids) values ('local-dev', ${hashKey(DEV_KEY)}, ${[478, 999]})
    on conflict (key_hash) do nothing`;
}

serve({ fetch: createApp(sql).fetch, port: 3000 }, ({ port }) => {
  console.log(`API on http://localhost:${port}${usesLocalDatabase ? ` (x-api-key: ${DEV_KEY})` : ""}`);
});
