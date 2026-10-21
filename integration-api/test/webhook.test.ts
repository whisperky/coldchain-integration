import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import samples from "../contracts/sample-tive-payloads.json" with { type: "json" };
import { startLocalPostgres } from "../scripts/local-postgres.js";
import { createApp } from "../src/api.js";
import { hashKey } from "../src/auth.js";
import { connect, migrate, type Sql } from "../src/db.js";

const KEY = "pxk_test";
const dataDir = join(tmpdir(), `integration-api-test-${process.pid}`);
let stopPostgres: () => Promise<void>;
let sql: Sql;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const pg = await startLocalPostgres(dataDir, 54330);
  stopPostgres = pg.stop;
  sql = connect(pg.url);
  await migrate(sql);
  await sql`insert into api_keys (name, key_hash, account_ids) values ('test', ${hashKey(KEY)}, ${[478]})`;
  app = createApp(sql);
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await stopPostgres?.();
  // Windows keeps the data files locked for a moment after Postgres stops.
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

let minute = 0;
const reading = (changes: object = {}) => {
  const epoch = Date.UTC(2025, 1, 10) + ++minute * 60_000;
  return {
    ...samples.payloads[0].payload,
    EntryTimeEpoch: epoch,
    EntryTimeUtc: new Date(epoch).toISOString(),
    ...changes,
  };
};

const post = (body: unknown, key = KEY) =>
  app.request("/api/webhook/tive", {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("rejects a missing or unknown key and stores nothing", async () => {
  const before = await sql`select count(*)::int as n from tive_events`;
  expect((await post(reading(), "pxk_wrong")).status).toBe(401);
  expect((await app.request("/api/webhook/tive", { method: "POST", body: "{}" })).status).toBe(401);
  expect(await sql`select count(*)::int as n from tive_events`).toEqual(before);
});

test.each(["{not json", "null"])("rejects the body %s", async (body) => {
  expect((await post(body)).status).toBe(400);
});

test("stores a new reading once and answers a resend as a duplicate", async () => {
  const payload = reading();
  const first = await post(payload);
  const created = await first.json();
  expect(first.status).toBe(201);
  const [stored] = await sql`select temperature from sensor_readings where event_id = ${created.event_id}`;
  expect(stored.temperature).toBe(10.08);

  const again = await post(payload);
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ status: "duplicate", sensor: created.sensor, location: created.location });
});

test("answers a resend as a duplicate when a value rounds to -0", async () => {
  const payload = reading({ Accelerometer: { G: 1, X: -0.0004, Y: 0, Z: 1 } });
  expect((await post(payload)).status).toBe(201);
  expect((await post(payload)).status).toBe(200);
});

test("keeps the first reading when a different one arrives for the same device and time", async () => {
  const payload = reading();
  await post(payload);
  const changed = await post({ ...payload, Temperature: { Celsius: 12.5 } });
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ status: "conflict", sensor: null, errors: [{ code: "conflict" }] });
  const [stored] =
    await sql`select temperature from sensor_readings where recorded_at = ${new Date(payload.EntryTimeEpoch)}`;
  expect(stored.temperature).toBe(10.08);
});

test("keeps a rejected payload for review", async () => {
  const response = await post(samples.payloads[1].payload);
  expect(response.status).toBe(422);
  const { event_id } = await response.json();
  const [event] = await sql`select status, payload from tive_events where id = ${event_id}`;
  expect(event).toMatchObject({ status: "rejected", payload: { Location: { Latitude: 95 } } });
});

test("refuses an account the key may not write", async () => {
  const response = await post(reading({ AccountId: 999 }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ errors: [{ code: "account_not_allowed" }] });
});

test("stores one reading when identical requests race", async () => {
  const payload = reading();
  const statuses = (await Promise.all(Array.from({ length: 10 }, () => post(payload)))).map((r) => r.status);
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 200)).toHaveLength(9);
  const [{ n }] =
    await sql`select count(*)::int as n from sensor_readings where recorded_at = ${new Date(payload.EntryTimeEpoch)}`;
  expect(n).toBe(1);
});
