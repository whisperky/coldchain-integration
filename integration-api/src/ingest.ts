import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import type { ApiKey } from "./auth.js";
import type { Sql } from "./db.js";
import { type Issue, type LocationRecord, type SensorRecord, transform } from "./transform.js";

type Tx = postgres.TransactionSql;
type Outcome = "accepted" | "duplicate" | "conflict" | "rejected";
type Records = { sensor: SensorRecord | null; location: LocationRecord | null };
type EventBody = Records & { event_id: string; status: Outcome; warnings: Issue[]; errors: Issue[] };
export type Reply = { status: 200 | 201 | 403 | 409 | 422; body: EventBody };

export async function receive(sql: Sql, key: ApiKey, payload: postgres.JSONValue): Promise<Reply> {
  const [event] = await sql<{ id: string }[]>`
    insert into tive_events (api_key_id, payload) values (${key.id}, ${sql.json(payload)}) returning id`;
  return processEvent(sql, key, event.id, payload);
}

export function processEvent(sql: Sql, key: ApiKey, eventId: string, payload: unknown): Promise<Reply> {
  return sql.begin(async (tx) => {
    const result = transform(payload);
    if (!result.ok) return finish(tx, reply(422, eventId, "rejected", { errors: result.errors }));

    const { sensor, location, accountId, shipmentId, warnings } = result;
    if (accountId !== null && !key.account_ids.includes(accountId)) {
      const error = {
        code: "account_not_allowed",
        field: "AccountId",
        message: `Key cannot write account ${accountId}`,
      };
      return finish(tx, reply(403, eventId, "rejected", { warnings, errors: [error] }));
    }

    const context = { event_id: eventId, account_id: accountId, shipment_id: shipmentId };
    const inserted = await tx`
      insert into sensor_readings ${tx(toRow(sensor, context))}
      on conflict (provider, device_imei, recorded_at) do nothing returning id`;
    if (inserted.length > 0) {
      await tx`insert into location_readings ${tx(toRow(location, context))}`;
      return finish(tx, reply(201, eventId, "accepted", { sensor, location, warnings }));
    }

    // Compare as stored: JSON turns -0 into 0.
    const stored = await readStored(tx, sensor);
    if (isDeepStrictEqual(stored, JSON.parse(JSON.stringify({ sensor, location })))) {
      return finish(tx, reply(200, eventId, "duplicate", { sensor, location, warnings }));
    }
    const error = { code: "conflict", field: "EntryTimeEpoch", message: "A different reading is stored for this time" };
    return finish(tx, reply(409, eventId, "conflict", { warnings, errors: [error] }));
  });
}

async function readStored(tx: Tx, { provider, device_imei, timestamp }: SensorRecord): Promise<Records> {
  const recordedAt = new Date(timestamp);
  const [sensor] = await tx`
    select * from sensor_readings
    where provider = ${provider} and device_imei = ${device_imei} and recorded_at = ${recordedAt}`;
  const [location] = await tx`
    select * from location_readings
    where provider = ${provider} and device_imei = ${device_imei} and recorded_at = ${recordedAt}`;
  return { sensor: fromRow(sensor), location: fromRow(location) };
}

function toRow({ timestamp, ...record }: SensorRecord | LocationRecord, context: Record<string, unknown>) {
  return { ...record, ...context, recorded_at: new Date(timestamp) };
}

function fromRow<T>({ id, event_id, account_id, shipment_id, created_at, recorded_at, ...record }: postgres.Row): T {
  return { ...record, timestamp: recorded_at.getTime() } as T;
}

async function finish(tx: Tx, result: Reply): Promise<Reply> {
  const { event_id, status, warnings, errors } = result.body;
  await tx`
    update tive_events set status = ${status}, warnings = ${tx.json(warnings)}, errors = ${tx.json(errors)}
    where id = ${event_id}`;
  return result;
}

function reply(
  status: Reply["status"],
  eventId: string,
  outcome: Outcome,
  parts: Partial<Records & Pick<EventBody, "warnings" | "errors">>,
): Reply {
  return {
    status,
    body: { event_id: eventId, status: outcome, sensor: null, location: null, warnings: [], errors: [], ...parts },
  };
}
