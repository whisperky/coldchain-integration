# Tive → PAXAFE integration

Two apps:

- **`integration-api/`** receives Tive webhooks at `POST /api/webhook/tive`, validates them, turns each payload into one PAXAFE sensor record and one PAXAFE location record, and stores them in PostgreSQL.
- **`mock-tive-sender/`** is a web app that generates Tive payloads, sends them to the API, and checks every answer against the status it expects.

| App | URL |
|---|---|
| Integration API | https://coldchain-integration-api.vercel.app (`/health`, `POST /api/webhook/tive`) |
| Mock Tive Sender | https://coldchain-mock-sender.vercel.app |

The test API key is in the submission email. It may write Tive accounts 478 and 999.

## Run locally

Node 24 is the only requirement. The API starts its own PostgreSQL 17 ([embedded-postgres](https://github.com/leinelissen/embedded-postgres), data in `integration-api/.pgdata/`) unless `DATABASE_URL` points at another Postgres.

```bash
cd integration-api && npm install && npm run dev    # http://localhost:3000, x-api-key: pxk_local_dev
cd mock-tive-sender && npm install && npm run dev   # http://localhost:3001
```

In both apps: `npm test` and `npm run check` (Biome + tsc). The API also has `npm run test:mutation` (Stryker on the transform).

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/webhook/tive` | ingest one Tive payload (needs an `x-api-key` header) |
| `GET` | `/health` | checks the database |

```bash
curl -X POST http://localhost:3000/api/webhook/tive \
  -H "x-api-key: pxk_local_dev" -H "content-type: application/json" \
  -d '{"DeviceId":"863257063350583","DeviceName":"A571992","EntryTimeEpoch":1739217446000,
       "Temperature":{"Celsius":10.078125},"Accelerometer":{"G":0.99,"X":-0.5625,"Y":-0.4375,"Z":0.6875},
       "Location":{"Latitude":40.810562,"Longitude":-73.879285,"LocationMethod":"wifi","Accuracy":{"Meters":23}}}'
```

```json
{
  "event_id": "57292b7a-e46f-4867-be1f-3767daf61656",
  "status": "accepted",
  "sensor": {
    "device_id": "A571992", "device_imei": "863257063350583", "timestamp": 1739217446000,
    "provider": "Tive", "type": "Active", "temperature": 10.08, "humidity": null, "light_level": null,
    "accelerometer": { "x": -0.563, "y": -0.438, "z": 0.688, "magnitude": 0.99 }, "tilt": null, "box_open": null
  },
  "location": {
    "device_id": "A571992", "device_imei": "863257063350583", "timestamp": 1739217446000,
    "provider": "Tive", "type": "Active", "latitude": 40.810562, "longitude": -73.879285, "altitude": null,
    "location_accuracy": 23, "location_accuracy_category": "High", "location_source": "WiFi", "address": null,
    "battery_level": null, "cellular_dbm": null, "cellular_network_type": null, "cellular_operator": null,
    "wifi_access_points": null
  },
  "warnings": [],
  "errors": []
}
```

| Status | When | Stored |
|---|---|---|
| 201 | new reading | event, sensor record, location record |
| 200 | the same reading again | event, marked duplicate |
| 409 | same device and time, different values | event, marked conflict; the first reading stays |
| 422 | the payload breaks the Tive schema | event, marked rejected, with field errors |
| 403 | `AccountId` is not allowed for this key | event, marked rejected |
| 401 | missing or unknown key | nothing |
| 400 / 413 | body is not JSON (or is `null`) / is over 64 KB | nothing |
| 500 | unexpected error | event, if saved, stays `received`; Tive retries once, and `npm run reprocess` picks up the rest |

## How a payload is handled

1. The key is hashed (sha256) and looked up in `api_keys`.
2. The raw payload is saved to `tive_events` and committed before anything else. [Tive retries once, and only on a 5xx](https://developers.tive.com/docs/webhooks), so a 2xx must mean the payload is stored.
3. The payload is validated against the provided Tive JSON Schema, plus the checks below that a schema cannot express.
4. It becomes one PAXAFE sensor record and one location record.
5. Both records are inserted in one transaction. `UNIQUE (provider, device_imei, recorded_at)` turns a resend into a no-op: the same values give 200, different values give 409, and the first reading is kept. The database enforces this, so parallel resends are safe too.

The answer is synchronous. A Tive payload is about 1.3 KB and processing takes milliseconds, so the sender sees the real result right away. Because the raw event is stored first, steps 3–5 can move to a queue worker later; Tive would still get a 2xx only once the payload is stored.

## Data rules

Input is fixed only when the fix is certain. Anything else that breaks the Tive schema rejects the whole payload, and the raw payload is kept for review and replay.

| Input | Samples | Result |
|---|---|---|
| `EntryTimeEpoch` in seconds | #6 | multiplied by 1000, warning `epoch_seconds` |
| `EntryTimeUtc` disagrees with the epoch | #12 (5 h off) | the epoch is used, warning `utc_mismatch` |
| numbers sent as strings | #8 | parsed, warning `numeric_string` |
| latitude or longitude out of range | #2, #9 | 422 |
| no `DeviceId` | #5, #13 | 422; the device is never guessed from a name |
| temperature 327.67 or -32768 | #4, #7 (as probe values) | temperature `null`, warning `no_reading` |
| timestamp before 2015 or more than 10 minutes ahead | | 422 |

## Mapping

| PAXAFE | Tive |
|---|---|
| `device_id` | `DeviceName` (not `EntityName`, which users can rename) |
| `device_imei` | `DeviceId` (not `Shipment.DeviceId`, which differs in #1 and #8) |
| `timestamp` | `EntryTimeEpoch` |
| `temperature` | `Temperature.Celsius`, 2 decimals |
| `humidity`, `light_level` | `Humidity.Percentage`, `Light.Lux`, 1 decimal |
| `accelerometer` | `Accelerometer` X, Y, Z and G (magnitude), 3 decimals |
| `latitude`, `longitude` | `Location.Latitude`, `Location.Longitude` |
| `location_accuracy` | `Location.Accuracy.Meters`, integer |
| `location_accuracy_category` | up to 50 m High, up to 500 m Medium, above that Low |
| `location_source` | `Location.LocationMethod`: gps → GPS, wifi → WiFi, cell → Cellular |
| `address` | parsed from `Location.FormattedAddress`; `street` stays null, as in the PAXAFE example |
| `battery_level`, `cellular_dbm`, `wifi_access_points` | `Battery.Percentage`, `Cellular.Dbm`, `Location.WifiAccessPointUsedCount` |

`provider` is always `Tive` and `type` is always `Active`. Fields Tive has no source for (`altitude`, `tilt`, `box_open`, `cellular_network_type`, `cellular_operator`) are null. Rounding is half away from zero, because the PAXAFE example needs -0.5625 → -0.563, which `Math.round` and banker's rounding get wrong. Tive fields with no PAXAFE field (probe temperature, Fahrenheit, shipment details) stay in the raw payload.

## Database

Schema: [`integration-api/migrations/001_init.sql`](integration-api/migrations/001_init.sql).

- `api_keys`: sha256 of each key, its name, the Tive accounts it may write, `revoked_at`.
- `tive_events`: every authenticated delivery, rejected ones included, with the raw `payload`, `status`, `warnings` and `errors`. It is the audit trail and the source for replays.
- `sensor_readings`, `location_readings`: the two PAXAFE record types, one row each per accepted payload. Scalars are typed columns (latitude, longitude, battery and accuracy category have check constraints); nested objects (`accelerometer`, `address`, `tilt`) are jsonb; `recorded_at` is timestamptz. `account_id` and `shipment_id` sit next to each reading.

## Tests

- `test/transform.test.ts`: sample 1 must equal the examples inside the PAXAFE schema files; each of the 13 samples has its expected outcome and warning/error codes; every accepted record passes the PAXAFE schemas; one test per data rule.
- `test/webhook.test.ts`, against a real Postgres: auth, duplicate, conflict, rejected payload kept, account check, and 10 identical requests in parallel storing one row.
- Mutation score of `transform.ts`: 88.4% (Stryker).
- The sender's scenarios double as an end-to-end check of a deployed API.

## Deployment

Vercel, one project per app (Root Directory `integration-api` or `mock-tive-sender`), with Neon Postgres (free tier; it scales to zero when idle and wakes on the next request). `npm run vercel-build` applies the migrations. Environment: `DATABASE_URL` for the API, `API_BASE_URL` for the sender. Keys are created with `npm run key:create -- --name <name> --accounts 478,999`.

Measured on `GET /health` from one PC: 1.1 s when warm (most of it the TLS handshake from that PC), 2.0 s for the first request after 7 idle minutes. The first call after the very first deploy took 23.5 s, so expect a slow first request after a long idle period.

## Assumptions

- `temperature` comes from `Temperature.Celsius`, not the probe: the PAXAFE example uses the internal sensor.
- An epoch below 10^12 is in seconds. `EntryTimeEpoch` wins over `EntryTimeUtc`.
- 327.67 and -32768 mean "no reading". Tive does not document them; they are int16 sentinels (32767 / 100 and -32768).
- The accuracy thresholds (50 m, 500 m) are an assumption; PAXAFE does not define them.
- One payload per request, as Tive sends one record per event.
- `DeviceId` follows the given schema (15 digits). There is no IMEI check-digit test: 5 of the 7 IDs in the samples would fail it.
- Unknown fields are ignored and kept in the raw payload. Late and out-of-order readings are normal and accepted.
- `AccountId` is optional in the schema (sample #11 has none), so a payload without it is accepted for any valid key. A production version would bind each device to its account.
- One repository holds both apps (the email asks for "GitHub repo link(s)"); each app deploys from its own folder.

## Next steps

- Verify Tive's `x-tive-signature` HMAC as well as the key.
- Move processing to a queue worker when volume needs it; the events table is already the inbox.
- Partition the reading tables by month as they grow.
- Separate keys for webhook writes and for reads, with a rate limit per key.
