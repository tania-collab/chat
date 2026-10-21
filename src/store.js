// Connections, settings and delivery logs, kept in the Workers KV namespace bound as RELAY.

import { PLATFORMS, DEFAULT_COMPLETED } from "./messages.js";

const LOG_SIZE = 20;
const EVENTS = ["created", "updated", "completed"];

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

export async function getLog(kv, id) {
  return (await kv.get(`log:${id}`, "json")) || [];
}

export async function addLog(kv, id, entry) {
  const log = await getLog(kv, id);
  await kv.put(`log:${id}`, JSON.stringify([entry, ...log].slice(0, LOG_SIZE)));
}

export async function deleteLog(kv, id) {
  await kv.delete(`log:${id}`);
}

// Validate what the page sends. Returns {value} or {error}.
export function cleanConnection(input, existing = {}) {
  const name = String(input.name || "").trim();
  const platform = String(input.platform || "");
  const chatUrl = String(input.chatUrl || "").trim();
  if (!name) return { error: "Give the connection a name." };
  if (!PLATFORMS[platform]) return { error: "Pick Google Chat or Slack." };
  if (!chatUrl.startsWith(PLATFORMS[platform].urlPrefix)) {
    return { error: `A ${PLATFORMS[platform].label} webhook URL starts with ${PLATFORMS[platform].urlPrefix}` };
  }
  const events = Object.fromEntries(EVENTS.map((e) => [e, Boolean(input.events?.[e])]));
  return {
    value: {
      id: existing.id || newId(),
      createdAt: existing.createdAt || new Date().toISOString(),
      name,
      platform,
      chatUrl,
      token: String(input.token || "").trim(),
      events,
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
