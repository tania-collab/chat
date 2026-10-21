// In-memory stand-ins for Cloudflare KV and the chat webhook.
import worker from "../src/worker.js";

export const ORIGIN = "https://relay.example";
export const PASSWORD = "pw-123";

export function memoryKv() {
  const data = new Map();
  return {
    async get(key, type) {
      const v = data.get(key);
      return v == null ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); },
  };
}

export function makeEnv() {
  return { RELAY: memoryKv(), ADMIN_PASSWORD: PASSWORD };
}

const auth = "Basic " + Buffer.from(`me:${PASSWORD}`).toString("base64");

export function admin(env, method, path, body, headers = {}) {
  return worker.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: { Authorization: auth, Origin: ORIGIN, "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

export function hook(env, id, event, token) {
  return worker.fetch(
    new Request(`${ORIGIN}/hook/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-zInspector-Webhook-Token": token } : {}) },
      body: JSON.stringify(event),
    }),
    env,
  );
}

// Replace the global fetch the worker uses to reach the chat; records each call.
export async function withChat(status, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(status === 200 ? "{}" : "Invalid JSON payload", { status });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

// The task.created event zInspector sent on 2026-10-21 (captured through Zapier).
export const created = {
  id: "e694ccb2-d767-4837-b8df-71ad91f08331",
  type: "task.created",
  version: 1,
  occurredAt: "2026-10-21T21:21:48.329392+00:00",
  data: {
    id: 2160012,
    type: "Marketing Required",
    status: { id: 1, value: "New" },
    priority: 3,
    assignedTo: { id: 42116, name: "Tania Aquirre", email: "tania@zinspector.com" },
    propertyName: "Marketing.Conferences",
    propertyAddress: "123 Jones, Davis, CA 95616, US",
    referenceNumber: "313307",
    description: "test task",
  },
};

export const withStatus = (value, type = "task.updated") => ({
  ...created,
  type,
  data: { ...created.data, status: { id: 9, value } },
});

export const GCHAT_URL = "https://chat.googleapis.com/v1/spaces/AAA/messages?key=K&token=T";
