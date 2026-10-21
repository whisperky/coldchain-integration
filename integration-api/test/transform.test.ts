import { Ajv } from "ajv";
import { expect, test } from "vitest";
import locationSchema from "../contracts/px-location-schema.json" with { type: "json" };
import sensorSchema from "../contracts/px-sensor-schema.json" with { type: "json" };
import samples from "../contracts/sample-tive-payloads.json" with { type: "json" };
import { type Issue, transform } from "../src/transform.js";

const ajv = new Ajv({ strict: false, validateFormats: false });
const isSensor = ajv.compile(sensorSchema);
const isLocation = ajv.compile(locationSchema);

const sample = (name: string) => {
  const found = samples.payloads.find((s) => s.name === name);
  if (!found) throw new Error(`No sample named ${name}`);
  return structuredClone(found.payload);
};
const standard = sample("Standard Temperature Shipment");
const changed = (changes: object) => ({ ...standard, ...changes });
const movedTo = (location: object) => changed({ Location: { ...standard.Location, ...location } });
const issues = (list: Issue[]) => list.map(({ code, field }) => `${code}:${field}`);

test("sample 1 maps exactly to the PAXAFE examples", () => {
  expect(transform(standard)).toEqual({
    ok: true,
    sensor: sensorSchema.examples[0],
    location: locationSchema.examples[0],
    accountId: 478,
    shipmentId: "CL-13686/PHARMA-SHIP/COLD-LOGISTICS",
    warnings: [],
  });
});

test.each([
  ["Standard Temperature Shipment", "accepted", []],
  ["Device A571992 Reading", "rejected", ["maximum:Location.Latitude"]],
  ["GPS Location Shipment", "accepted", []],
  ["Vaccine Shipment Checkpoint", "accepted", []],
  ["Device Name Only", "rejected", ["required:DeviceId"]],
  ["Biologics Replenishment Shipment", "accepted", ["epoch_seconds:EntryTimeEpoch"]],
  ["Cellular Location Only", "accepted", []],
  [
    "Standard Temperature Shipment Update",
    "accepted",
    ["numeric_string:Cellular.Dbm", "numeric_string:Temperature.Celsius", "numeric_string:Temperature.Fahrenheit"],
  ],
  ["Device A571992 Follow-up Reading", "rejected", ["minimum:Location.Longitude"]],
  ["Clinical Supply Shipment", "accepted", []],
  ["Minimal Data Payload", "accepted", []],
  ["Vaccine Shipment Southbound", "accepted", ["utc_mismatch:EntryTimeUtc"]],
  ["Entity and Device Name", "rejected", ["required:DeviceId"]],
])("%s is %s %j", (name, outcome, expected) => {
  const result = transform(sample(name));
  if (result.ok) {
    expect(["accepted", issues(result.warnings)]).toEqual([outcome, expected]);
    expect(isSensor(result.sensor) && isLocation(result.location)).toBe(true);
  } else {
    expect(["rejected", issues(result.errors)]).toEqual([outcome, expected]);
  }
});

test.each([
  ["Biologics Replenishment Shipment", "sensor.timestamp", 1739561246000],
  ["Vaccine Shipment Southbound", "sensor.timestamp", 1739647646000],
  ["Standard Temperature Shipment Update", "sensor.temperature", 10.5],
  ["Vaccine Shipment Checkpoint", "sensor.temperature", 4.63],
  [
    "Vaccine Shipment Checkpoint",
    "location.address",
    {
      street: null,
      locality: "Richmond",
      state: "VA",
      country: "USA",
      postal_code: "23219",
      full_address: "Richmond, VA 23219, USA",
    },
  ],
  ["Cellular Location Only", "location.location_accuracy_category", "Medium"],
  ["Cellular Location Only", "location.location_source", "Cellular"],
  [
    "Cellular Location Only",
    "location.address",
    { street: null, locality: "London", state: null, country: "UK", postal_code: null, full_address: "London, UK" },
  ],
  ["Minimal Data Payload", "location.location_accuracy_category", null],
  ["Minimal Data Payload", "location.address", null],
  ["Minimal Data Payload", "sensor.accelerometer", null],
])("%s: %s is %j", (name, path, value) => {
  expect(transform(sample(name))).toHaveProperty(path, value);
});

test("warns when EntryTimeUtc cannot be read", () => {
  expect(transform(changed({ EntryTimeUtc: "yesterday" }))).toMatchObject({
    ok: true,
    warnings: [{ code: "utc_mismatch", field: "EntryTimeUtc" }],
  });
});

test.each([327.67, -32768])("treats temperature %d as no reading", (celsius) => {
  expect(transform(changed({ Temperature: { Celsius: celsius } }))).toMatchObject({
    ok: true,
    sensor: { temperature: null },
    warnings: [{ code: "no_reading", field: "Temperature.Celsius" }],
  });
});

test.each([
  ["an integer sent as a string", changed({ Battery: { Percentage: "64" } }), "location.battery_level", 64],
  ["a long decimal sent as a string", changed({ Temperature: { Celsius: "10.078125" } }), "sensor.temperature", 10.08],
  ["a clock 5 minutes ahead", changed({ EntryTimeEpoch: Date.now() + 5 * 60_000 }), "ok", true],
  ["accuracy of 50 m", movedTo({ Accuracy: { Meters: 50 } }), "location.location_accuracy_category", "High"],
  ["accuracy of 501 m", movedTo({ Accuracy: { Meters: 501 } }), "location.location_accuracy_category", "Low"],
  [
    "an address it cannot split",
    movedTo({ FormattedAddress: "Maasvlakte 2, Rotterdam, NL" }),
    "location.address.locality",
    null,
  ],
])("accepts %s", (_label, input, path, value) => {
  expect(transform(input)).toHaveProperty(path, value);
});

test.each([
  ["JSON that is not an object", "not an object", ["type:"]],
  ["a missing nested field", movedTo({ Latitude: undefined }), ["required:Location.Latitude"]],
  [
    "every problem at once",
    changed({ DeviceId: undefined, Location: { ...standard.Location, Latitude: 95 } }),
    ["required:DeviceId", "maximum:Location.Latitude"],
  ],
  ["a timestamp before 2015", changed({ EntryTimeEpoch: 0 }), ["timestamp_out_of_range:EntryTimeEpoch"]],
  [
    "a timestamp an hour ahead",
    changed({ EntryTimeEpoch: Date.now() + 60 * 60_000 }),
    ["timestamp_out_of_range:EntryTimeEpoch"],
  ],
])("rejects %s", (_label, input, expected) => {
  const result = transform(input);
  expect(result.ok ? [] : issues(result.errors)).toEqual(expected);
});
