"use client";

import { useEffect, useState } from "react";
import { generateReading } from "../lib/generate";
import { groups, type Result, type Scenario, type Send } from "../lib/scenarios";

type Run = { results: Result[]; pass: boolean };

const button = "rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-40";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function Sender({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [apiKey, setApiKey] = useState("");
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [running, setRunning] = useState(false);
  const [custom, setCustom] = useState("");
  const [customResults, setCustomResults] = useState<Result[]>([]);

  useEffect(() => setCustom(pretty(generateReading())), []);

  const send: Send = async (payload, options = {}) => {
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, apiKey: options.apiKey ?? apiKey, copies: options.copies }),
    });
    return response.json();
  };

  async function run(scenarios: Scenario[]) {
    setRunning(true);
    try {
      for (const scenario of scenarios) {
        const results = await scenario.run(send);
        const pass = scenario.passes(results.map((r) => r.status));
        setRuns((current) => ({ ...current, [scenario.name]: { results, pass } }));
      }
    } finally {
      setRunning(false);
    }
  }

  async function sendCustom() {
    let payload: unknown;
    try {
      payload = JSON.parse(custom);
    } catch {
      setCustomResults([{ status: 0, ms: 0, body: "Not valid JSON" }]);
      return;
    }
    setCustomResults(await send(payload));
  }

  const all = groups.flatMap((group) => group.scenarios);
  const finished = all.filter((scenario) => runs[scenario.name]);
  const passed = finished.filter((scenario) => runs[scenario.name].pass).length;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 text-sm">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">Mock Tive Sender</h1>
        <p className="text-gray-600">
          Sends Tive payloads to <code>{apiBaseUrl}/api/webhook/tive</code> and checks each answer.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="API key"
            className="w-96 rounded border px-2 py-1 font-mono"
            placeholder="x-api-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
          />
          <button className={button} disabled={!apiKey || running} onClick={() => run(all)} type="button">
            Run all
          </button>
          {finished.length > 0 && (
            <span>
              {passed} of {finished.length} passed
            </span>
          )}
        </div>
      </header>

      {groups.map((group) => (
        <section key={group.name}>
          <h2 className="mb-2 font-semibold">{group.name}</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-1">Scenario</th>
                <th>Expected</th>
                <th>Got</th>
                <th>ms</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {group.scenarios.map((scenario) => {
                const result = runs[scenario.name];
                return (
                  <tr key={scenario.name} className="border-b align-top">
                    <td className="py-1 pr-4">{scenario.name}</td>
                    <td className="pr-4">{scenario.expected}</td>
                    <td className={result?.pass ? "pr-4 text-green-700" : "pr-4 text-red-700"}>
                      {result && (
                        <details>
                          <summary className="cursor-pointer">
                            {result.pass ? "✓" : "✗"} {result.results.map((r) => r.status).join(", ")}
                          </summary>
                          <pre className="max-h-96 max-w-2xl overflow-auto bg-gray-50 p-2 text-xs text-gray-800">
                            {pretty(result.results.map((r) => r.body))}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="pr-4">{result?.results.map((r) => r.ms).join(", ")}</td>
                    <td>
                      <button
                        className={button}
                        disabled={!apiKey || running}
                        onClick={() => run([scenario])}
                        type="button"
                      >
                        Run
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="font-semibold">Custom payload</h2>
        <textarea
          aria-label="Payload"
          className="h-80 w-full rounded border p-2 font-mono text-xs"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <div className="flex gap-2">
          <button className={button} onClick={() => setCustom(pretty(generateReading()))} type="button">
            New reading
          </button>
          <button className={button} disabled={!apiKey} onClick={sendCustom} type="button">
            Send
          </button>
        </div>
        {customResults.length > 0 && (
          <pre className="overflow-auto bg-gray-50 p-2 text-xs">{pretty(customResults)}</pre>
        )}
      </section>
    </main>
  );
}
