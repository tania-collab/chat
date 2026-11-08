// zInspector -> chat relay: a Cloudflare Worker with an admin page.
//
//   POST /hook/<connection id>   zInspector webhook target (public, checks the connection's token)
//   GET  /                       admin page
//   /api/...                     admin JSON API used by the page
//
// Sign-in: Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD) when set, else the ADMIN_PASSWORD secret.
// Bindings: KV namespace RELAY. Summaries read zInspector with the ZINSPECTOR_API_KEY secret (optional).

import { DEFAULT_COMPLETED, buildMessage, buildPayload, cardFor, skipReason, SKIP_REASONS, AUDIENCES, ALERTS, alertsOf, eventKind, deliveryUrl, render, fieldPaths, templateFor, EVENTS, EXAMPLES, EXAMPLE_PREVIOUS, TEST_MESSAGE } from "./messages.js";
import { snapshotOf, EXTRA_NAMES } from "./taskview.js";
import { buildDigest, selectTasks, nextSendTime, sendTimeLabel, isSummaryTime, summaryOf, describeSchedule, POST_DAYS, POST_HOURS, MAX_DAYS_AHEAD, OVERDUE_WITHIN, QUIET_DAYS, QUIET_UP_TO, OWNERS, DEFAULT_INTRO, INTRO_DETAILS } from "./digest.js";
import { zinspectorConfigured, readsZinspector, openTasksOn, resolveProperties, searchProperties, todosOf, ZinspectorError } from "./summary.js";
import {
  getConnections,
  saveConnections,
  getSettings,
  getActivity,
  saveActivity,
  deleteActivity,
  cleanConnection,
  cleanSettings,
  cleanSummary,
} from "./store.js";
import { ADMIN_HTML } from "./admin.js";
import { accessConfigured, accessCheck } from "./access.js";

// When the app saw the task created and finished, for the weekly digest's "last week" numbers.
function withDates(snapshot, previous, event, kind, settings) {
  const now = new Date().toISOString();
  const done = (settings.completedStatuses || DEFAULT_COMPLETED).split(",").map((x) => x.trim().toLowerCase());
  const stillDone = done.includes(String(snapshot.status).toLowerCase());
  const createdAt = previous?.createdAt || (event.type === "task.created" ? now : null);
  const finishedAt = kind === "task.completed" ? now : stillDone ? previous?.finishedAt || null : null;
  // Each event is activity on the task, for the summary's "going quiet".
  return { ...snapshot, createdAt, finishedAt, lastActivity: now };
}

export default {
  // Cron (wrangler.toml) fires every hour at :30; each chat's summary goes out on its days, at its hour (Pacific).
  async scheduled(controller, env, ctx) {
    if (!env.RELAY) return;
    ctx.waitUntil(sendDigests(env, new Date(controller.scheduledTime)));
  },

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

  // zInspector decides which events this webhook sends; each one is posted unless it changed nothing visible.
  const settings = await getSettings(env.RELAY);
  const activity = await getActivity(env.RELAY, connection.id);
  const taskId = event.type.startsWith("task.") ? event.data?.id : null;
  const previous = taskId != null ? activity.tasks[String(taskId)] || null : null;
  const kind = eventKind(event, settings, previous);
  const skip = skipReason(event, connection, settings, previous);
  const result = skip
    ? { ok: true, status: 200, body: `Not posted: ${SKIP_REASONS[skip]}.`, skipped: skip }
    : await postToChat(connection, event, buildPayload(event, connection, settings, previous));
  // Remember the task's state (also when not posted) so the next update can say what changed.
  const keepsState = taskId != null && event.type !== "task.message.created" && result.ok;
  const snapshot = keepsState ? withDates(snapshotOf(event.data), previous, event, kind, settings) : null;
  await saveActivity(env.RELAY, connection.id, activity, { entry: logEntry(kind, event, result), kind, event, previous, snapshot });
  // Pass the chat's answer back so zInspector's Delivery History shows it.
  return text(result.body, result.ok ? 200 : 502);
}

async function sendDigests(env, now) {
  const due = (await getConnections(env.RELAY)).filter((c) => isSummaryTime(summaryOf(c), now));
  const cache = new Map(); // one zInspector read per property for all chats
  for (const connection of due) {
    try {
      await sendDigest(env, connection, now, cache);
    } catch (err) {
      console.error(err);
    }
  }
}

const TODO_READS = 10;

// Posts one chat's summary; returns {ok, status, detail}, or null when there was nothing to list. A failed
// zInspector read is logged in the chat's history (and returned) instead of posting a partial list.
async function sendDigest(env, connection, now = new Date(), cache = new Map(), { preview = false } = {}) {
  const summary = summaryOf(connection);
  const activity = await getActivity(env.RELAY, connection.id);
  const settings = await getSettings(env.RELAY);
  const event = { type: "digest" };
  let tasks;
  const fromZinspector = readsZinspector(env, summary);
  if (fromZinspector) {
    try {
      const ids = [...new Set(summary.properties.flatMap((p) => p.ids))];
      tasks = await openTasksOn(env, settings.appOrigin, ids, cache);
      // The next step on the dated tasks it will list (a few reads, within a run's request budget).
      const dated = selectTasks(tasks, summary, settings, now).filter((t) => t.dueDate).slice(0, TODO_READS);
      const steps = new Map();
      for (const t of dated) steps.set(t.id, await todosOf(env, settings.appOrigin, t.id));
      tasks = tasks.map((t) => (steps.get(t.id) ? { ...t, todo: steps.get(t.id) } : t));
    } catch (err) {
      if (!(err instanceof ZinspectorError)) throw err;
      if (preview) return { ok: false, status: err.status, detail: err.message };
      const entry = logEntry("digest", event, { ok: false, status: err.status, body: err.message }, "app");
      await saveActivity(env.RELAY, connection.id, activity, { entry, kind: "test", event });
      return { ok: false, status: err.status, detail: entry.detail };
    }
  } else {
    tasks = Object.entries(activity.tasks || {}).map(([id, t]) => ({ id, ...t }));
  }
  // Last week's numbers fit a summary posted once a week.
  const pulse = !fromZinspector && summary.postDays.length === 1;
  const payload = buildDigest(connection, tasks, settings, now, { pulse, preview });
  if (!payload) return null;
  if (preview) return { ok: true, preview: payload.text };
  const res = await fetch(connection.chatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  const entry = logEntry("digest", event, { ok: res.ok, status: res.status, body: await res.text() }, "app");
  await saveActivity(env.RELAY, connection.id, await getActivity(env.RELAY, connection.id), { entry, kind: "test", event });
  return { ok: entry.ok, status: entry.status, detail: entry.detail };
}

// Looks up the property lines typed in a chat's settings into {summary.properties}; {error} when one isn't found.
async function withProperties(env, input, existing, origin) {
  if (!input.summary || !Array.isArray(input.summary.propertyLines)) return { value: input };
  try {
    const known = summaryOf(existing).properties;
    const { value, error } = await resolveProperties(env, origin, input.summary.propertyLines.slice(0, 100), known);
    if (error) return { error };
    return { value: { ...input, summary: { ...input.summary, properties: value } } };
  } catch (err) {
    if (err instanceof ZinspectorError) return { error: err.message };
    throw err;
  }
}

// `payload` is {text} or {text, cardsV2}.
async function postToChat(connection, event, payload) {
  const res = await fetch(deliveryUrl(connection, event), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// For the chat's card: the last message posted (or failed), and whether zInspector has reached the chat yet.
function health(entries) {
  const last = entries.find((e) => !e.skipped) || null;
  return {
    last: last && { at: last.at, ok: last.ok, status: last.status, detail: last.detail, kind: last.kind, title: last.title || "" },
    chatReached: entries.some((e) => !e.skipped && e.ok),
    zinspectorReached: entries.some((e) => e.source !== "app"),
  };
}

// `source` is "app" for what the app sends by itself (test message, digest); zInspector's events have none.
function logEntry(kind, event, result, source = null) {
  const person = event.data?.assignedTo || event.data?.assignedToContact;
  return {
    at: new Date().toISOString(),
    kind,
    type: event.type,
    source,
    taskId: event.data?.id ?? null,
    ref: event.data?.referenceNumber || null,
    title: String(event.data?.description || "").split("\n")[0].slice(0, 120),
    person: person ? String(person.name ?? person) : "",
    ok: result.ok,
    skipped: result.skipped || false,
    status: result.status,
    detail: result.ok ? "" : result.body.slice(0, 300),
  };
}

async function api(request, env, url, user) {
  const kv = env.RELAY;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = request.method;

  if (parts[1] === "state" && method === "GET") {
    // zInspector checks the Origin of the summary's reads; remember this app's address for the scheduled ones.
    const current = await getSettings(kv);
    if (current.appOrigin !== url.origin) await kv.put("settings", JSON.stringify({ ...current, appOrigin: url.origin }));
    return json({
      // Messages still on an earlier default show (and save) as the current default.
      connections: await Promise.all(
        (await getConnections(kv)).map(async (c) => ({
          ...c,
          templates: Object.fromEntries(EVENTS.map((e) => [e.key, templateFor(c, e.key)])),
          alerts: alertsOf(c),
          summary: summaryOf(c),
          summaryWhen: describeSchedule(summaryOf(c)),
          health: health((await getActivity(kv, c.id)).entries),
        })),
      ),
      settings: await getSettings(kv),
      hookBase: `${url.origin}/hook/`,
      user: user.email,
      events: EVENTS,
      audiences: AUDIENCES,
      alerts: ALERTS,
      skipReasons: SKIP_REASONS,
      postDays: POST_DAYS,
      postHours: POST_HOURS,
      maxDaysAhead: MAX_DAYS_AHEAD,
      overdueWithin: OVERDUE_WITHIN,
      owners: OWNERS,
      quietDays: QUIET_DAYS,
      quietUpTo: QUIET_UP_TO,
      summaryIntro: DEFAULT_INTRO,
      introDetails: INTRO_DETAILS,
      summaryReadsZinspector: zinspectorConfigured(env),
    });
  }

  // Render a template against the connection's last real event of that kind, or example data.
  if (parts[1] === "preview" && method === "POST") {
    const input = await request.json();
    const kind = EVENTS.some((e) => e.key === input.kind) ? input.kind : "other";
    const activity = input.connectionId ? await getActivity(kv, String(input.connectionId)) : { samples: {} };
    const sample = activity.samples[kind];
    const event = sample?.event || EXAMPLES[kind];
    const previous = sample ? sample.previous || null : EXAMPLE_PREVIOUS[kind] || null;
    const platform = input.platform === "slack" ? "slack" : "google-chat";
    return json({
      text: render(String(input.template || ""), event, await getSettings(kv), platform, previous, kind),
      card: EVENTS.find((e) => e.key === kind)?.card ? cardFor(event, await getSettings(kv), platform, previous, kind) : null,
      fields: [...EXTRA_NAMES, ...fieldPaths(event)],
      source: sample ? "real" : "example",
      at: sample?.at || null,
    });
  }

  // The summary's property picker: zInspector properties whose name contains ?q=.
  if (parts[1] === "properties" && method === "GET") {
    if (!zinspectorConfigured(env)) return json({ error: "Add a zInspector API key to search its properties." }, 400);
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2) return json({ error: "Type at least 2 letters." }, 400);
    try {
      return json(await searchProperties(env, url.origin, query));
    } catch (err) {
      if (err instanceof ZinspectorError) return json({ error: err.message }, 502);
      throw err;
    }
  }

  if (parts[1] === "settings" && method === "PUT") {
    const { value, error } = cleanSettings(await request.json());
    if (error) return json({ error }, 400);
    await kv.put("settings", JSON.stringify({ ...value, appOrigin: url.origin }));
    return json(value);
  }

  if (parts[1] !== "connections") return json({ error: "Not found" }, 404);
  const connections = await getConnections(kv);
  const id = parts[2];

  if (!id && method === "POST") {
    const input = await withProperties(env, await request.json(), {}, url.origin);
    if (input.error) return json({ error: input.error }, 400);
    const { value, error } = cleanConnection(input.value, {}, user.email);
    if (error) return json({ error }, 400);
    await saveConnections(kv, [...connections, value]);
    return json(value, 201);
  }

  const existing = connections.find((c) => c.id === id);
  if (!existing) return json({ error: "Connection not found" }, 404);

  if (!parts[3] && method === "PUT") {
    const input = await withProperties(env, await request.json(), existing, url.origin);
    if (input.error) return json({ error: input.error }, 400);
    const { value, error } = cleanConnection(input.value, existing, user.email);
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
  // With {preview, summary} (the settings form, not saved yet): the summary's text, without posting it.
  if (parts[3] === "digest" && method === "POST") {
    const input = await request.json().catch(() => ({}));
    if (input.preview) {
      const resolved = await withProperties(env, input, existing, url.origin);
      if (resolved.error) return json({ error: resolved.error }, 400);
      const connection = { ...existing, summary: cleanSummary(resolved.value.summary, summaryOf(existing)) };
      // As the chat would get it the next time it goes out (or now, when the summary is off).
      const at = nextSendTime(summaryOf(connection)) || new Date();
      const result = await sendDigest(env, connection, at, new Map(), { preview: true });
      return json({ ...(result || { ok: true, empty: true }), at: sendTimeLabel(at, summaryOf(connection)) });
    }
    const result = await sendDigest(env, existing);
    return json(result || { ok: true, empty: true });
  }
  if (parts[3] === "test" && method === "POST") {
    const event = { type: "webhook.test" };
    const result = await postToChat(existing, event, { text: TEST_MESSAGE });
    const entry = logEntry("test", event, result, "app");
    await saveActivity(kv, id, await getActivity(kv, id), { entry, kind: "test", event });
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
