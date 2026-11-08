// Reading zInspector for the summary: the open tasks on a chat's chosen properties, and the properties' ids.
// Read-only, with the ZINSPECTOR_API_KEY secret. zInspector checks the request's Origin against the key's
// whitelist: ZINSPECTOR_ORIGIN when set, else this app's own address.

import { MAX_PROPERTIES } from "./digest.js";
import { localDate } from "./time.js";

const API = "https://portfolio.zinspector.com/api";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

export function zinspectorConfigured(env) {
  return Boolean(env.ZINSPECTOR_API_KEY);
}

// The tasks a summary reads: from zInspector when it has an API key and the chat has chosen properties
// (a whole account is too much to read on a schedule), else the ones the app has seen.
export function readsZinspector(env, summary) {
  return zinspectorConfigured(env) && summary.onlyProperties && summary.properties.some((p) => p.ids?.length);
}

// Open (active) tasks on the given property ids, as task snapshots with their id. `cache` (a Map) shares
// one read per property between the chats of one run.
export async function openTasksOn(env, origin, ids, cache = new Map()) {
  const lists = [];
  for (const id of ids) {
    if (!cache.has(id)) cache.set(id, await readAll(env, origin, "/tasks/", { active: "true", Property: id }));
    lists.push(cache.get(id));
  }
  // People's emails, to @mention them through the People list; without them the names show in bold.
  if (!cache.has("users")) {
    cache.set("users", await readAll(env, origin, "/user/", {}).catch((err) => (err instanceof ZinspectorError ? [] : Promise.reject(err))));
  }
  const users = new Map(cache.get("users").map((u) => [u.id, u]));
  return [...new Map(lists.flat().map((t) => [t.id, t])).values()].map((t) => taskFromApi(t, users));
}

// Turns the lines typed in a chat's settings into properties: a number or a zInspector link becomes an id,
// a name is looked up ("Marketing.BizDev*" finds every property whose name starts with Marketing.BizDev).
// Lines already looked up (`known`) are reused. Returns {value} or {error}.
export async function resolveProperties(env, origin, lines, known = []) {
  const entries = [];
  for (const raw of lines.map((l) => String(l).trim()).filter(Boolean)) {
    const again = known.find((k) => k.label === raw && (k.ids?.length || !zinspectorConfigured(env)));
    if (again) {
      entries.push(again);
      continue;
    }
    const id = raw.match(/^\d+$/)?.[0] || raw.match(/^https?:\/\/\S*?(\d{3,})\/?$/)?.[1];
    if (id) {
      entries.push({ label: raw, name: "", ids: [Number(id)] });
      continue;
    }
    if (!zinspectorConfigured(env)) {
      entries.push({ label: raw, name: raw, ids: [] });
      continue;
    }
    const prefix = raw.endsWith("*");
    const want = (prefix ? raw.slice(0, -1) : raw).trim().toLowerCase();
    const found = (await readAll(env, origin, "/propertiesCursor/", { search: want }, 2)).filter((p) => {
      const name = String(p.Name || "").toLowerCase();
      return prefix ? name.startsWith(want) : name === want;
    });
    if (!found.length) {
      return {
        error: `Couldn't find the property "${raw}" in zInspector. Check the spelling (it's the name as zInspector shows it, like Marketing.Comms), or paste the property's link from zInspector instead.`,
      };
    }
    entries.push({ label: raw, name: raw, ids: found.map((p) => p.id) });
  }
  const total = entries.reduce((n, e) => n + Math.max(1, e.ids.length), 0);
  if (total > MAX_PROPERTIES) {
    return { error: `That's ${total} properties; a summary can follow up to ${MAX_PROPERTIES}. Pick fewer, or narrower names.` };
  }
  return { value: entries };
}

// Properties whose name contains `query`, for the settings' property picker: [{id, name}], at most 100.
export async function searchProperties(env, origin, query) {
  const want = String(query).trim().toLowerCase();
  const found = await readAll(env, origin, "/propertiesCursor/", { search: want }, 1);
  return found
    .filter((p) => String(p.Name || "").toLowerCase().includes(want))
    .map((p) => ({ id: p.id, name: String(p.Name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100);
}

// What's left on a task's to-do list: {next, done, total}, or null when it has none or zInspector won't share
// them (the route isn't documented for API keys, so a refusal just leaves the step out).
export async function todosOf(env, origin, taskId) {
  try {
    const rows = (await readAll(env, origin, "/task/todos/", { Task: String(taskId) }, 1)).filter((r) => String(r.Task ?? r.task ?? taskId) === String(taskId));
    if (!rows.length) return null;
    const field = (r, names) => names.map((n) => r[n]).find((v) => v != null);
    const steps = rows
      .map((r) => ({
        text: String(field(r, ["description", "Description", "Name", "name", "Title", "title"]) || "").trim(),
        done: Boolean(field(r, ["completed", "Completed", "IsCompleted", "isCompleted", "IsDone", "Done"])),
        order: Number(field(r, ["sort_order", "SortOrder", "Order", "order"]) ?? 0),
        kind: String(field(r, ["type", "Type", "TodoType", "todo_type", "ItemType"]) ?? "").toUpperCase(),
      }))
      // Only real steps: a Documents slot or a note isn't something to do.
      .filter((s) => s.text && !["DOCUMENT", "NOTE"].includes(s.kind))
      .sort((a, b) => a.order - b.order);
    const next = steps.find((s) => !s.done);
    return next ? { next: next.text.slice(0, 120), done: steps.filter((s) => s.done).length, total: steps.length } : null;
  } catch (err) {
    if (err instanceof ZinspectorError) return null;
    throw err;
  }
}

// A task from zInspector's API in the shape the app keeps from webhooks (see taskview.js snapshotOf).
export function taskFromApi(t, users = new Map()) {
  const person = (id, name) => (id || name ? { name: name || userName(users.get(id)) || "Someone", email: users.get(id)?.email || "" } : null);
  return {
    id: String(t.id),
    status: String(t.Status ?? ""),
    assignee: person(t.AssignedToUser, t.AssignedToUserName),
    nextPerson: person(t.NextToDo, t.NextToDoName),
    manager: person(t.ManagedBy, t.ManagedByName),
    priority: t.Priority ?? null,
    // zInspector stores due times in UTC; the team's day is Pacific.
    due: t.EndDate ? (String(t.EndDate).length > 10 ? localDate(new Date(t.EndDate)) : t.EndDate) : null,
    dueAt: String(t.EndDate || "").length > 10 ? t.EndDate : null,
    type: String(t.Action ?? ""),
    description: String(t.Description ?? "").slice(0, 500),
    next: String(t.NextToDoName ?? ""),
    propertyName: String(t.PropertyName ?? ""),
    lastActivity: t.LastModified || null,
    createdAt: t.DateCreated || null,
    propertyId: t.Property ?? null,
  };
}

function userName(u) {
  return u ? [u.FirstName, u.LastName].filter(Boolean).join(" ") : "";
}

// Every row of a list route, following its `next` links.
async function readAll(env, origin, path, params, maxPages = MAX_PAGES) {
  const rows = [];
  let url = `${API}${path}?${new URLSearchParams({ page_size: String(PAGE_SIZE), ...params })}`;
  for (let page = 0; page < maxPages && url; page++) {
    const headers = { Accept: "application/json", "x-api-key": env.ZINSPECTOR_API_KEY };
    if (env.ZINSPECTOR_ORIGIN || origin) headers.Origin = env.ZINSPECTOR_ORIGIN || origin;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new ZinspectorError(res.status, await res.text());
    const body = await res.json();
    if (Array.isArray(body)) return [...rows, ...body];
    rows.push(...(body.results || []));
    // `next` is a full address; keep its query on our own base so the key only goes to zInspector.
    url = body.next ? `${API}${path}?${new URL(body.next, API).searchParams}` : null;
  }
  return rows;
}

export class ZinspectorError extends Error {
  constructor(status, body) {
    const why =
      status === 401 || status === 403
        ? "zInspector refused the API key. Check the ZINSPECTOR_API_KEY secret, and that this app's address is on the key's whitelist (or set ZINSPECTOR_ORIGIN to one that is)."
        : `zInspector answered ${status}.`;
    super(`${why} ${String(body || "").slice(0, 200)}`.trim());
    this.status = status;
  }
}
