import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

export async function startLocalPostgres(databaseDir: string, port: number) {
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: true,
    // Windows initdb defaults to WIN1252 and local time.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "timezone=UTC"],
  });
  if (!existsSync(databaseDir)) await pg.initialise();
  await pg.start();
  return { url: `postgres://postgres:postgres@localhost:${port}/postgres`, stop: () => pg.stop() };
}
