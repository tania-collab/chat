// Connections, settings and delivery logs, kept in the Workers KV namespace bound as RELAY.

import { PLATFORMS, DEFAULT_COMPLETED, EVENTS, MAX_TEMPLATE } from "./messages.js";

const LOG_SIZE = 20;

export async function getConnections(kv) {
  return (await kv.get("connections", "json")) || [];
}

export async function saveConnections(kv, connections) {
  await kv.put("connections", JSON.stringify(connections));
}

export async function getSettings(kv) {
  const saved = (await kv.get("settings", "json")) || {};
  return { taskUrl: "", completedStatuses: DEFAULT_COMPLETED, people: [], ...saved };
}

// Per connection: the last deliveries, and the last event of each kind (for previews and field names).
export async function getActivity(kv, id) {
  return { entries: [], samples: {}, ...((await kv.get(`log:${id}`, "json")) || {}) };
}

export async function addActivity(kv, id, entry, kind, event) {
  const activity = await getActivity(kv, id);
  const samples = kind && kind !== "test" ? { ...activity.samples, [kind]: { at: entry.at, event } } : activity.samples;
  await kv.put(`log:${id}`, JSON.stringify({ entries: [entry, ...activity.entries].slice(0, LOG_SIZE), samples }));
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
  return {
    value: {
      taskUrl,
      completedStatuses: String(input.completedStatuses || "").trim() || DEFAULT_COMPLETED,
      people,
    },
  };
}

function newId() {
  return crypto.randomUUID().replaceAll("-", "");
}
