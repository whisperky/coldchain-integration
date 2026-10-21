import { Ajv } from "ajv";
import { expect, test } from "vitest";
import tiveSchema from "../contracts/tive-incoming-schema.json";
import { generateReading } from "../lib/generate";

test("generated readings satisfy the Tive schema", () => {
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(tiveSchema);
  for (let i = 0; i < 100; i++) expect(validate(generateReading())).toBe(true);
});

test("generated readings never share a timestamp", () => {
  const timestamps = Array.from({ length: 5 }, () => generateReading().EntryTimeEpoch);
  expect(new Set(timestamps).size).toBe(5);
});
