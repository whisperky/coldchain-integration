import { API_BASE_URL } from "../../../lib/config";

const MAX_COPIES = 20;

export async function POST(request: Request) {
  const { payload, apiKey, copies } = await request.json();

  const sendOnce = async () => {
    const started = performance.now();
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhook/tive`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": String(apiKey) },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, ms: Math.round(performance.now() - started), body };
    } catch (error) {
      return { status: 0, ms: Math.round(performance.now() - started), body: String(error) };
    }
  };

  const count = Math.min(Number(copies) || 1, MAX_COPIES);
  return Response.json(await Promise.all(Array.from({ length: count }, sendOnce)));
}
