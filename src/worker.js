// zInspector -> chat relay: a Cloudflare Worker with an admin page.
//
//   POST /hook/<connection id>   zInspector webhook target (public, checks the connection's token)
//   GET  /                       admin page
//   /api/...                     admin JSON API used by the page
//
// Sign-in: Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD) when set, else the ADMIN_PASSWORD secret.
// Bindings: KV namespace RELAY.

import { buildMessage, eventKind, deliveryUrl, render, fieldPaths, EVENTS, EXAMPLES, TEST_MESSAGE } from "./messages.js";
import {
  getConnections,
  saveConnections,
  getSettings,
  getActivity,
  addActivity,
  deleteActivity,
  cleanConnection,
  cleanSettings,
} from "./store.js";
import { ADMIN_HTML } from "./admin.js";
import { accessConfigured, accessCheck } from "./access.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/hook/")) return await relay(request, env, url.pathname.slice(6));
      if (!env.RELAY || (!accessConfigured(env) && !env.ADMIN_PASSWORD)) {
        return text("Setup is not finished: add the RELAY KV binding, and Cloudflare Access or the ADMIN_PASSWORD secret.", 503);
      }
      const user = await signedInUser(request, env);
      if (user?.problem) return text(`Sign-in didn't work: ${user.problem}`, 403);
      if (!user) {
        return new Response("Password required", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="zInspector chat relay", charset="UTF-8"' },
        });
      }
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(ADMIN_HTML, { headers: htmlHeaders() });
      }
      if (url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.headers.get("origin") !== url.origin) {
          return json({ error: "Cross-site request refused" }, 403);
        }
        return await api(request, env, url, user);
      }
      return text("Not found", 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  },
};

async function relay(request, env, id) {
  if (request.method !== "POST") return text("This address takes zInspector webhooks (POST).", 405);
  const connection = env.RELAY && (await getConnections(env.RELAY)).find((c) => c.id === id);
  if (!connection) return text("Unknown connection", 404);

  const token = request.headers.get("x-zinspector-webhook-token") || "";
  if (connection.token && !safeEqual(token, connection.token)) return text("Bad webhook token", 401);

  let event;
  try {
    event = await request.json();
  } catch {
    return text("Body is not JSON", 400);
  }

  if (!event || typeof event.type !== "string") return text("Not a zInspector event", 400);

  // zInspector decides which events this webhook sends; every one that arrives is posted.
  const settings = await getSettings(env.RELAY);
  const kind = eventKind(event, settings);
  const result = await postToChat(connection, event, buildMessage(event, connection, settings));
  await addActivity(env.RELAY, connection.id, logEntry(kind, event, result), kind, event);
  // Pass the chat's answer back so zInspector's Delivery History shows it.
  return text(result.body, result.ok ? 200 : 502);
}

async function postToChat(connection, event, message) {
  const res = await fetch(deliveryUrl(connection, event), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text: message }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

function logEntry(kind, event, result) {
  return {
    at: new Date().toISOString(),
    kind,
    type: event.type,
    taskId: event.data?.id ?? null,
    ref: event.data?.referenceNumber || null,
    ok: result.ok,
    status: result.status,
    detail: result.ok ? "" : result.body.slice(0, 300),
  };
}

async function api(request, env, url, user) {
  const kv = env.RELAY;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = request.method;

  if (parts[1] === "state" && method === "GET") {
    return json({
      connections: await getConnections(kv),
      settings: await getSettings(kv),
      hookBase: `${url.origin}/hook/`,
      user: user.email,
      events: EVENTS,
    });
  }

  // Render a template against the connection's last real event of that kind, or example data.
  if (parts[1] === "preview" && method === "POST") {
    const input = await request.json();
    const kind = EVENTS.some((e) => e.key === input.kind) ? input.kind : "other";
    const activity = input.connectionId ? await getActivity(kv, String(input.connectionId)) : { samples: {} };
    const sample = activity.samples[kind];
    const event = sample?.event || EXAMPLES[kind];
    const platform = input.platform === "slack" ? "slack" : "google-chat";
    return json({
      text: render(String(input.template || ""), event, await getSettings(kv), platform),
      fields: fieldPaths(event),
      source: sample ? "real" : "example",
      at: sample?.at || null,
    });
  }

  if (parts[1] === "settings" && method === "PUT") {
    const { value, error } = cleanSettings(await request.json());
    if (error) return json({ error }, 400);
    await kv.put("settings", JSON.stringify(value));
    return json(value);
  }

  if (parts[1] !== "connections") return json({ error: "Not found" }, 404);
  const connections = await getConnections(kv);
  const id = parts[2];

  if (!id && method === "POST") {
    const { value, error } = cleanConnection(await request.json(), {}, user.email);
    if (error) return json({ error }, 400);
    await saveConnections(kv, [...connections, value]);
    return json(value, 201);
  }

  const existing = connections.find((c) => c.id === id);
  if (!existing) return json({ error: "Connection not found" }, 404);

  if (!parts[3] && method === "PUT") {
    const { value, error } = cleanConnection(await request.json(), existing, user.email);
    if (error) return json({ error }, 400);
    await saveConnections(kv, connections.map((c) => (c.id === id ? value : c)));
    return json(value);
  }
  if (!parts[3] && method === "DELETE") {
    await saveConnections(kv, connections.filter((c) => c.id !== id));
    await deleteActivity(kv, id);
    return json({ ok: true });
  }
  if (parts[3] === "log" && method === "GET") return json((await getActivity(kv, id)).entries);
  if (parts[3] === "test" && method === "POST") {
    const event = { type: "webhook.test" };
    const result = await postToChat(existing, event, TEST_MESSAGE);
    const entry = logEntry("test", event, result);
    await addActivity(kv, id, entry, "test", event);
    return json({ ok: entry.ok, status: entry.status, detail: entry.detail });
  }
  return json({ error: "Not found" }, 404);
}

// The signed-in person ({email}), {problem} when the Access sign-in fails, or null without a password.
// With a password there's no email: {email: null}.
async function signedInUser(request, env) {
  if (accessConfigured(env)) return accessCheck(request, env);
  return passwordOk(request, env) ? { email: null } : null;
}

function passwordOk(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  return safeEqual(decoded.slice(decoded.indexOf(":") + 1), env.ADMIN_PASSWORD);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" },
  });
}

function text(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=UTF-8" } });
}

function htmlHeaders() {
  return {
    "Content-Type": "text/html; charset=UTF-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
  };
}
