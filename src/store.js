// Connections, settings and delivery logs, kept in the Workers KV namespace bound as RELAY.

import { PLATFORMS, DEFAULT_COMPLETED, DEFAULT_TASK_URL, EVENTS, MAX_TEMPLATE, AUDIENCES, DEFAULT_AUDIENCE, ALERTS } from "./messages.js";

const LOG_SIZE = 20;
const MAX_PEOPLE = 5000;
const TASKS_KEPT = 300;

export async function getConnections(kv) {
  return (await kv.get("connections", "json")) || [];
}

export async function saveConnections(kv, connections) {
  await kv.put("connections", JSON.stringify(connections));
}

export async function getSettings(kv) {
  const saved = (await kv.get("settings", "json")) || {};
  // "Completed,Closed" was the first default; zInspector has no "Completed" status.
  const completed = saved.completedStatuses === "Completed,Closed" ? "" : saved.completedStatuses;
  return {
    people: [],
    ...saved,
    taskUrl: saved.taskUrl || DEFAULT_TASK_URL,
    completedStatuses: completed || DEFAULT_COMPLETED,
  };
}

// Per connection, in one KV value (one write per delivery): the last deliveries, the last event of each
// kind (for previews and field names), and the last known state of recent tasks (to tell what changed).
export async function getActivity(kv, id) {
  return { entries: [], samples: {}, tasks: {}, ...((await kv.get(`log:${id}`, "json")) || {}) };
}

export async function saveActivity(kv, id, activity, { entry, kind, event, previous = null, snapshot = null }) {
  const samples = kind && kind !== "test" ? { ...activity.samples, [kind]: { at: entry.at, event, previous } } : activity.samples;
  let tasks = activity.tasks;
  const taskId = event.data?.id;
  if (snapshot && taskId != null) {
    // Re-insert so the most recently seen tasks are kept when trimming.
    const { [taskId]: _, ...rest } = tasks;
    tasks = Object.fromEntries([...Object.entries(rest), [String(taskId), snapshot]].slice(-TASKS_KEPT));
  }
  await kv.put(`log:${id}`, JSON.stringify({ entries: [entry, ...activity.entries].slice(0, LOG_SIZE), samples, tasks }));
}

export async function deleteActivity(kv, id) {
  await kv.delete(`log:${id}`);
}

// Validate what the page sends. Returns {value} or {error}.
export function cleanConnection(input, existing = {}, by = null) {
  const name = String(input.name || "").trim();
  const platform = String(input.platform || "");
  const chatUrl = String(input.chatUrl || "").trim();
  if (!name) return { error: "Give the connection a name." };
  if (!PLATFORMS[platform]) return { error: "Pick Google Chat or Slack." };
  if (!chatUrl.startsWith(PLATFORMS[platform].urlPrefix)) {
    return { error: `A ${PLATFORMS[platform].label} webhook URL starts with ${PLATFORMS[platform].urlPrefix}` };
  }
  const templates = {};
  for (const { key, label, template } of EVENTS) {
    const text = typeof input.templates?.[key] === "string" ? input.templates[key] : template;
    if (text.length > MAX_TEMPLATE) return { error: `The "${label}" message is too long.` };
    templates[key] = text;
  }
  return {
    value: {
      id: existing.id || newId(),
      createdAt: existing.createdAt || new Date().toISOString(),
      createdBy: existing.id ? existing.createdBy || null : by,
      updatedBy: by,
      name,
      platform,
      chatUrl,
      token: String(input.token || "").trim(),
      only: AUDIENCES[input.only] ? input.only : DEFAULT_AUDIENCE,
      alerts: Object.fromEntries(
        Object.entries(ALERTS).map(([k, a]) => [k, typeof input.alerts?.[k] === "boolean" ? input.alerts[k] : a.on]),
      ),
      templates,
    },
  };
}

export function cleanSettings(input) {
  const taskUrl = String(input.taskUrl || "").trim();
  if (taskUrl && !/^https:\/\/.+\{id\}/.test(taskUrl)) {
    return { error: "The task link must start with https:// and contain {id}." };
  }
  const people = (Array.isArray(input.people) ? input.people : [])
    .map((p) => ({
      email: String(p.email || "").trim().toLowerCase(),
      googleChatId: String(p.googleChatId || "").trim().replace(/^users\//, ""),
      slackId: String(p.slackId || "").trim(),
    }))
    .filter((p) => p.email);
  // One row per email (the last one wins), so a pasted list can't create duplicates.
  const byEmail = [...new Map(people.map((p) => [p.email, p])).values()];
  if (byEmail.length > MAX_PEOPLE) return { error: `The people list can hold up to ${MAX_PEOPLE} people.` };
  return {
    value: {
      taskUrl,
      completedStatuses: String(input.completedStatuses || "").trim() || DEFAULT_COMPLETED,
      people: byEmail,
    },
  };
}

function newId() {
  return crypto.randomUUID().replaceAll("-", "");
}
