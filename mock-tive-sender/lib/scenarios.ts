import samples from "../contracts/sample-tive-payloads.json";
import { generateReading } from "./generate";

export type Result = { status: number; ms: number; body: unknown };
export type Send = (payload: unknown, options?: { copies?: number; apiKey?: string }) => Promise<Result[]>;
export type Scenario = {
  name: string;
  expected: string;
  run: (send: Send) => Promise<Result[]>;
  passes: (statuses: number[]) => boolean;
};

const exactly =
  (...expected: number[]) =>
  (statuses: number[]) =>
    statuses.join() === expected.join();

const REJECTED_SAMPLES = [
  "Device A571992 Reading",
  "Device Name Only",
  "Device A571992 Follow-up Reading",
  "Entity and Device Name",
];

const sampleScenarios: Scenario[] = samples.payloads.map(({ name, payload }) =>
  REJECTED_SAMPLES.includes(name)
    ? { name, expected: "422", run: (send) => send(payload), passes: exactly(422) }
    : {
        name,
        expected: "201, or 200 once stored",
        run: (send) => send(payload),
        passes: ([status]) => status === 201 || status === 200,
      },
);

const edgeCases: Scenario[] = [
  {
    name: "New reading",
    expected: "201",
    run: (send) => send(generateReading()),
    passes: exactly(201),
  },
  {
    name: "Same reading sent twice",
    expected: "201, then 200",
    run: async (send) => {
      const reading = generateReading();
      return [...(await send(reading)), ...(await send(reading))];
    },
    passes: exactly(201, 200),
  },
  {
    name: "Different reading, same device and time",
    expected: "201, then 409",
    run: async (send) => {
      const reading = generateReading();
      return [...(await send(reading)), ...(await send({ ...reading, Temperature: { Celsius: 15 } }))];
    },
    passes: exactly(201, 409),
  },
  {
    name: "10 identical requests at once",
    expected: "one 201, nine 200",
    run: (send) => send(generateReading(), { copies: 10 }),
    passes: (statuses) =>
      statuses.filter((s) => s === 201).length === 1 && statuses.filter((s) => s === 200).length === 9,
  },
  {
    name: "Temperature 327.67 (no reading)",
    expected: "201",
    run: (send) => send({ ...generateReading(), Temperature: { Celsius: 327.67 } }),
    passes: exactly(201),
  },
  {
    name: "AccountId the key may not write",
    expected: "403",
    run: (send) => send({ ...generateReading(), AccountId: 12345 }),
    passes: exactly(403),
  },
  {
    name: "Wrong API key",
    expected: "401",
    run: (send) => send(generateReading(), { apiKey: "pxk_wrong" }),
    passes: exactly(401),
  },
];

export const groups = [
  { name: "Provided samples", scenarios: sampleScenarios },
  { name: "Edge cases", scenarios: edgeCases },
];
