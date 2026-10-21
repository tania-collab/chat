// Turns a zInspector webhook event into a chat message, from an editable template.
//
// Template syntax: {{path}} reads the event (e.g. {{data.propertyName}}, {{data.status}}, {{type}}), and
// ready-made values come from taskview.js ({{taskTitle}}, {{assignee}}, {{changes}}, ...). A line, or a
// part of a line between " · ", is left out when one of its placeholders is empty or missing.

export const PLATFORMS = {
  "google-chat": { label: "Google Chat", urlPrefix: "https://chat.googleapis.com/" },
  slack: { label: "Slack", urlPrefix: "https://hooks.slack.com/" },
};

import { taskExtras, nothingChanged, snapshotOf } from "./taskview.js";
import { LEGACY_TEMPLATES } from "./legacy.js";

// zInspector's finished statuses that mean the work got done (Canceled and Deferred don't celebrate).
export const DEFAULT_COMPLETED = "Work Complete,Closed";
export const DEFAULT_TASK_URL = "https://dashboard.zinspector.com/task/view/{id}";
export const TEST_MESSAGE = "✅ zInspector is connected to this chat.";
export const MAX_TEMPLATE = 4000;

// One entry per zInspector webhook event (plus "completed", a variant of task.updated, and a fallback).
// Messages about one task share a Google Chat thread, so each says only what's new and stays short.
export const EVENTS = [
  {
    key: "task.created",
    label: "Task created",
    template: [
      "🆕 *New task* · {{taskTitle}} · Ref {{data.referenceNumber}}",
      "🏠 {{data.propertyName}} · {{data.propertyAddress}}",
      "👤 {{assigneeOrUnassigned}} · 📅 Due {{dueDate}} · {{priorityFlag}}",
      "> {{shortDescription}}",
    ].join("\n"),
  },
  {
    key: "task.updated",
    label: "Task updated",
    hint: "posted only when something visible changed (status, assignee, dates, priority…); the list shows what",
    template: ["✏️ {{taskTitle}} · Ref {{data.referenceNumber}}", "{{changes}}"].join("\n"),
  },
  {
    key: "task.completed",
    label: "Task completed",
    hint: "a Task updated whose status just moved to a done status (once per task)",
    template: ["✅ *{{data.status}}* · {{taskTitle}} · Ref {{data.referenceNumber}}", "🎉 Nice work, {{assignee}}!"].join("\n"),
  },
  {
    key: "task.message.created",
    label: "New task message",
    template: [
      "💬 *New message* · {{taskTitle}} · Ref {{data.referenceNumber}}",
      "> {{messageText}}",
      "— {{messageAuthor}}",
    ].join("\n"),
  },
  {
    key: "report.distributed",
    label: "Reports distributed",
    template: ["📄 *Report sent* · {{data.propertyName}} · Ref {{data.referenceNumber}}", "🏠 {{data.propertyAddress}}"].join("\n"),
  },
  {
    key: "zdata.changed",
    label: "zData changed",
    template: ["🗂️ *{{data.area}} › {{data.detail}}* {{data.actionType}} · {{data.propertyName}}", "{{data.zData}}"].join("\n"),
  },
  {
    key: "other",
    label: "Any other event",
    hint: "events zInspector adds later",
    template: "🔔 *{{type}}* · {{data.propertyName}} · {{data.type}}",
  },
];

const EVENT_KEYS = EVENTS.map((e) => e.key);

// Example data for previews until a real event of that kind arrives.
const TASK_EXAMPLE = {
  id: 2160012,
  type: "Marketing Required",
  status: { id: 1, value: "New" },
  priority: 4,
  endDate: "2026-10-30",
  assignedTo: { id: 42116, name: "Tania Aguirre", email: "tania@zinspector.com" },
  propertyName: "Marketing.Conferences",
  propertyAddress: "123 Jones, Davis, CA 95616, US",
  referenceNumber: "313307",
  description: "Book the booth and send the attendee list by Friday.",
};
const UPDATED_EXAMPLE = {
  ...TASK_EXAMPLE,
  status: { id: 2, value: "In Progress" },
  assignedTo: { id: 49612, name: "Tim Wallace", email: "tim+onsight@zinspector.com" },
  endDate: "2026-11-02",
};
export const EXAMPLES = {
  "task.created": { type: "task.created", data: TASK_EXAMPLE },
  "task.updated": { type: "task.updated", data: UPDATED_EXAMPLE },
  "task.completed": { type: "task.updated", data: { ...UPDATED_EXAMPLE, status: { id: 5, value: "Work Complete" } } },
  "task.message.created": {
    type: "task.message.created",
    data: { ...TASK_EXAMPLE, message: { author: "Greg Owen", body_text: "Can we move this to Friday? The venue changed.\n\n-- \nGreg Owen • CTO" } },
  },
  "report.distributed": { type: "report.distributed", data: { propertyName: "Marketing.Conferences", propertyAddress: "123 Jones, Davis, CA 95616, US", referenceNumber: "313307" } },
  "zdata.changed": { type: "zdata.changed", data: { propertyName: "Marketing.Conferences", area: "Account", detail: "Software in use", zData: "AppFolio", actionType: "Updated" } },
  other: { type: "some.event", data: { propertyName: "Marketing.Conferences", type: "Marketing Required" } },
};
// What the task looked like before each example, so the previews can show changes.
export const EXAMPLE_PREVIOUS = {
  "task.updated": snapshotOf(TASK_EXAMPLE),
  "task.completed": snapshotOf(UPDATED_EXAMPLE),
};

// Which template an event uses: "test", one of EVENT_KEYS, or "other". `previous` is the task's last
// known state: a completion counts once, when the status moves into a done status.
export function eventKind(event, settings = {}, previous = null) {
  if (event.type === "webhook.test") return "test";
  if (event.type === "task.updated") {
    const done = (settings.completedStatuses || DEFAULT_COMPLETED)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const isDone = (status) => Boolean(status) && done.includes(String(status).toLowerCase());
    const nowDone = isDone(valueText(event.data?.status));
    return nowDone && !isDone(previous?.status) ? "task.completed" : "task.updated";
  }
  return EVENT_KEYS.includes(event.type) && event.type !== "other" ? event.type : "other";
}

// The default copy for every event.
export function defaultTemplates() {
  return Object.fromEntries(EVENTS.map((e) => [e.key, e.template]));
}

// The message for an event, or null when there's nothing worth posting (an update that changed nothing).
export function buildMessage(event, connection, settings = {}, previous = null) {
  const kind = eventKind(event, settings, previous);
  if (kind === "test") return TEST_MESSAGE;
  if (kind === "task.updated" && nothingChanged(previous, event.data)) return null;
  return render(templateFor(connection, kind), event, settings, connection.platform, previous, kind);
}

// A saved message still identical to an earlier default moves to the current default.
export function templateFor(connection, kind) {
  const fallback = EVENTS.find((e) => e.key === kind).template;
  const saved = connection.templates?.[kind];
  return saved == null || LEGACY_TEMPLATES[kind]?.includes(saved) ? fallback : saved;
}

export function render(template, event, settings = {}, platform = "google-chat", previous = null, kind = null) {
  const mentionOf = (person) => mentionFor(person, settings.people, platform);
  const link = taskUrl(event.data?.id, settings.taskUrl);
  const extras = {
    ...taskExtras({ event, previous, kind: kind || eventKind(event, settings, previous), link, mentionOf }),
    mention: mentionOf(event.data?.assignedTo || event.data?.assignedToContact),
  };
  const lookup = (path) => (Object.hasOwn(extras, path) ? extras[path] || "" : valueText(read(event, path)));

  const fill = (part) => part.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => lookup(p));
  const paths = (part) => [...part.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  return String(template)
    .split("\n")
    .map((line) => {
      const parts = line.split(" · ");
      const kept = parts.filter((part) => paths(part).every(lookup));
      // Drop the line when every part that had a placeholder came out empty.
      if (parts.some((p) => paths(p).length) && !kept.some((p) => paths(p).length)) return null;
      return kept.map(fill).join(" · ");
    })
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Every placeholder path an event offers, for the template helper.
export function fieldPaths(event, prefix = "", depth = 0) {
  if (event == null || typeof event !== "object" || depth > 3) return [];
  return Object.entries(event).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const isLeafObject = value && typeof value === "object" && ("value" in value || "name" in value);
    if (value && typeof value === "object" && !Array.isArray(value) && !isLeafObject) {
      return fieldPaths(value, path, depth + 1);
    }
    return [path];
  });
}

// Google Chat threads every message for one task together; Slack incoming webhooks can't thread.
export function deliveryUrl(connection, event) {
  const id = event.data?.id;
  if (connection.platform !== "google-chat" || id == null || !String(event.type).startsWith("task.")) {
    return connection.chatUrl;
  }
  const url = new URL(connection.chatUrl);
  url.searchParams.set("threadKey", `task-${id}`);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  return url.toString();
}

function read(obj, path) {
  return path.split(".").reduce((v, key) => (v != null && Object.hasOwn(Object(v), key) ? v[key] : undefined), obj);
}

// A status {id, value} shows its value, a person {name, email} their name; other objects as JSON.
function valueText(v) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (v.value != null) return String(v.value);
  if (v.name != null) return String(v.name);
  return JSON.stringify(v);
}

function mentionFor(person, people = [], platform) {
  if (!person) return null;
  const email = baseEmail(person.email);
  const match = email && people.find((p) => baseEmail(p.email) === email);
  if (platform === "google-chat" && match?.googleChatId) return `<users/${match.googleChatId}>`;
  if (platform === "slack" && match?.slackId) return `<@${match.slackId}>`;
  return person.name ? `*${person.name}*` : null;
}

// zInspector accounts often tag staff emails (aj+onsight@zinspector.com): match them to aj@zinspector.com.
function baseEmail(email) {
  return email ? String(email).toLowerCase().replace(/\+[^@]*(?=@)/, "") : "";
}

function taskUrl(id, template) {
  return template && id != null ? template.replace("{id}", encodeURIComponent(id)) : null;
}
