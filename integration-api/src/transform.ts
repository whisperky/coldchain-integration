import { Ajv, type ErrorObject } from "ajv";
import tiveSchema from "../contracts/tive-incoming-schema.json" with { type: "json" };

export type Issue = { code: string; field: string; message: string };

type TivePayload = {
  DeviceId: string;
  DeviceName: string;
  EntryTimeEpoch: number;
  EntryTimeUtc?: string;
  AccountId?: number;
  ShipmentId?: string | null;
  Temperature: { Celsius: number | null };
  Humidity?: { Percentage?: number | null } | null;
  Light?: { Lux?: number | null } | null;
  Accelerometer?: { G?: number | null; X?: number | null; Y?: number | null; Z?: number | null } | null;
  Battery?: { Percentage?: number | null } | null;
  Cellular?: { Dbm?: number | null } | null;
  Location: {
    Latitude: number;
    Longitude: number;
    FormattedAddress?: string | null;
    LocationMethod?: "gps" | "wifi" | "cell" | null;
    Accuracy?: { Meters?: number | null } | null;
    WifiAccessPointUsedCount?: number | null;
  };
};

type Head = { device_id: string; device_imei: string; timestamp: number; provider: "Tive"; type: "Active" };

export type Address = {
  street: string | null;
  locality: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  full_address: string;
};

export type SensorRecord = Head & {
  temperature: number | null;
  humidity: number | null;
  light_level: number | null;
  accelerometer: { x: number | null; y: number | null; z: number | null; magnitude: number | null } | null;
  tilt: null;
  box_open: null;
};

export type LocationRecord = Head & {
  latitude: number;
  longitude: number;
  altitude: null;
  location_accuracy: number | null;
  location_accuracy_category: "High" | "Medium" | "Low" | null;
  location_source: "GPS" | "WiFi" | "Cellular" | null;
  address: Address | null;
  battery_level: number | null;
  cellular_dbm: number | null;
  cellular_network_type: null;
  cellular_operator: null;
  wifi_access_points: number | null;
};

export type Transformed =
  | {
      ok: true;
      sensor: SensorRecord;
      location: LocationRecord;
      accountId: number | null;
      shipmentId: string | null;
      warnings: Issue[];
    }
  | { ok: false; errors: Issue[] };

type SchemaNode = { type?: string | string[]; properties?: Record<string, SchemaNode> };

const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile<TivePayload>(tiveSchema);

const NUMERIC = /^-?\d+(\.\d+)?$/;
// Earlier dates mean an unset device clock.
const EARLIEST = Date.UTC(2015, 0, 1);
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
// Int16 sentinels: 32767 / 100 and -32768.
const NO_READING = new Set([327.67, -32768]);
const SOURCES = { gps: "GPS", wifi: "WiFi", cell: "Cellular" } as const;
const US_STATE_ZIP = /^([A-Z]{2}) (\d{5})$/;

export function transform(input: unknown): Transformed {
  const warnings: Issue[] = [];
  const payload = parseNumericStrings(structuredClone(input), tiveSchema, "", warnings);
  if (!validate(payload)) return { ok: false, errors: (validate.errors ?? []).map(toIssue) };

  // Below 1e12 (2001 in ms) the epoch can only be seconds.
  const timestamp = payload.EntryTimeEpoch < 1e12 ? payload.EntryTimeEpoch * 1000 : payload.EntryTimeEpoch;
  if (timestamp !== payload.EntryTimeEpoch) {
    warnings.push({ code: "epoch_seconds", field: "EntryTimeEpoch", message: "Read as seconds, converted to ms" });
  }
  if (timestamp < EARLIEST || timestamp > Date.now() + MAX_CLOCK_SKEW_MS) {
    const message = "Must be between 2015-01-01 and 10 minutes from now";
    return { ok: false, errors: [{ code: "timestamp_out_of_range", field: "EntryTimeEpoch", message }] };
  }
  const utc = payload.EntryTimeUtc === undefined ? timestamp : Date.parse(payload.EntryTimeUtc);
  if (Number.isNaN(utc) || Math.abs(utc - timestamp) > 1000) {
    const message = `${payload.EntryTimeUtc} differs from EntryTimeEpoch; EntryTimeEpoch is used`;
    warnings.push({ code: "utc_mismatch", field: "EntryTimeUtc", message });
  }

  let temperature = payload.Temperature.Celsius;
  if (temperature !== null && NO_READING.has(temperature)) {
    const message = `${temperature} means the sensor had no reading`;
    warnings.push({ code: "no_reading", field: "Temperature.Celsius", message });
    temperature = null;
  }

  const head = {
    device_id: payload.DeviceName,
    device_imei: payload.DeviceId,
    timestamp,
    provider: "Tive",
    type: "Active",
  } as const;
  const accel = payload.Accelerometer;
  const loc = payload.Location;
  const meters = round(loc.Accuracy?.Meters, 0);

  return {
    ok: true,
    sensor: {
      ...head,
      temperature: round(temperature, 2),
      humidity: round(payload.Humidity?.Percentage, 1),
      light_level: round(payload.Light?.Lux, 1),
      accelerometer: accel
        ? { x: round(accel.X, 3), y: round(accel.Y, 3), z: round(accel.Z, 3), magnitude: round(accel.G, 3) }
        : null,
      tilt: null,
      box_open: null,
    },
    location: {
      ...head,
      latitude: loc.Latitude,
      longitude: loc.Longitude,
      altitude: null,
      location_accuracy: meters,
      location_accuracy_category: accuracyCategory(meters),
      location_source: loc.LocationMethod ? SOURCES[loc.LocationMethod] : null,
      address: parseAddress(loc.FormattedAddress),
      battery_level: payload.Battery?.Percentage ?? null,
      cellular_dbm: round(payload.Cellular?.Dbm, 2),
      cellular_network_type: null,
      cellular_operator: null,
      wifi_access_points: loc.WifiAccessPointUsedCount ?? null,
    },
    accountId: payload.AccountId ?? null,
    shipmentId: payload.ShipmentId ?? null,
    warnings,
  };
}

function parseNumericStrings(value: unknown, schema: SchemaNode, path: string, warnings: Issue[]): unknown {
  const types = [schema.type].flat();
  if (typeof value === "string" && (types.includes("number") || types.includes("integer")) && NUMERIC.test(value)) {
    warnings.push({ code: "numeric_string", field: path, message: `"${value}" was sent as a string` });
    return Number(value);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in record) record[key] = parseNumericStrings(record[key], child, path ? `${path}.${key}` : key, warnings);
    }
  }
  return value;
}

function toIssue({ keyword, instancePath, params, message }: ErrorObject): Issue {
  const field = [instancePath.slice(1).replaceAll("/", "."), params.missingProperty].filter(Boolean).join(".");
  return { code: keyword, field, message: message ?? "is invalid" };
}

// Half away from zero, as the PAXAFE examples need (-0.5625 → -0.563).
function round(value: number | null | undefined, digits: number): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

function accuracyCategory(meters: number | null): LocationRecord["location_accuracy_category"] {
  if (meters === null) return null;
  if (meters <= 50) return "High";
  if (meters <= 500) return "Medium";
  return "Low";
}

function parseAddress(text: string | null | undefined): Address | null {
  if (!text) return null;
  const parts = text.split(",").map((part) => part.trim());
  const address = { street: null, locality: null, state: null, country: null, postal_code: null, full_address: text };
  const stateZip = parts.length >= 3 ? US_STATE_ZIP.exec(parts[parts.length - 2]) : null;
  if (stateZip) {
    const [, state, postal_code] = stateZip;
    return { ...address, locality: parts[parts.length - 3], state, postal_code, country: parts[parts.length - 1] };
  }
  if (parts.length === 2) return { ...address, locality: parts[0], country: parts[1] };
  return address;
}
