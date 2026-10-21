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
import { taskCard, cardAsText, cardContent } from "./cards.js";

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
    card: true,
    fallback: "New task",
    hint: "the card's heading; the assignee is @mentioned above the card when their chat id is on file",
    template: "{{assigneeFirstName}} has a new task",
  },
  {
    key: "task.assigned",
    label: "Task newly assigned",
    card: true,
    fallback: "A task was assigned",
    hint: "a Task updated that gave the task to someone; the card's heading",
    template: "{{assigneeFirstName}} was assigned a task",
  },
  {
    key: "task.updated",
    label: "Task updated",
    hint: "posted only when something visible changed (status, dates, priority…); the list shows what",
    template: ["✏️ {{taskTitle}}", "{{changes}}"].join("\n"),
  },
  {
    key: "task.completed",
    label: "Task completed",
    card: true,
    fallback: "A task was finished",
    hint: "a Task updated whose status just moved to a done status (once per task); the card's heading",
    template: "{{assigneeFirstName}} finished a task ✅",
  },
  {
    key: "task.message.created",
    label: "New task message",
    template: [
      "💬 *New message* · {{taskTitle}}",
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
  manager: { id: 17416, name: "Laura E.", email: "laura@zinspector.com" },
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
  "task.assigned": { type: "task.updated", data: { ...TASK_EXAMPLE, assignedTo: UPDATED_EXAMPLE.assignedTo } },
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
  "task.assigned": snapshotOf(TASK_EXAMPLE),
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
    // Only a task the chat already knew as not done counts as completed (bulk clean-ups of old tasks don't).
    if (previous && nowDone && !isDone(previous.status)) return "task.completed";
    const assignee = snapshotOf(event.data || {}).assignee;
    if (previous && assignee && personKey(assignee) !== personKey(previous.assignee)) return "task.assigned";
    return "task.updated";
  }
  return EVENT_KEYS.includes(event.type) && event.type !== "other" ? event.type : "other";
}

// The default copy for every event.
export function defaultTemplates() {
  return Object.fromEntries(EVENTS.map((e) => [e.key, e.template]));
}

// Which tasks a chat hears about.
export const AUDIENCES = {
  "assigned-or-next": "Tasks with someone assigned or a next to-do",
  assigned: "Tasks with someone assigned",
  all: "All tasks",
};
export const DEFAULT_AUDIENCE = "assigned";

// Which task alerts a chat posts. Updates are always tracked, so "finished" works with "changes" off.
export const ALERTS = {
  created: { label: "New tasks", on: true },
  assigned: { label: "Newly assigned tasks", on: true },
  completed: { label: "Finished tasks (a done status)", on: true },
  changes: { label: "Other changes (status, dates, priority…)", on: false },
  messages: { label: "New messages on a task", on: false },
  digest: { label: "Weekly digest (Mondays 8:30am Pacific)", on: true },
};

export function alertsOf(connection) {
  return Object.fromEntries(
    Object.entries(ALERTS).map(([key, a]) => [key, typeof connection.alerts?.[key] === "boolean" ? connection.alerts[key] : a.on]),
  );
}

// Why an event isn't posted, or null when it is. Readable text for each reason is in SKIP_REASONS.
export const SKIP_REASONS = {
  "not-for-this-chat": "nobody on the task matches this chat's rule (assigned / next to-do)",
  "first-seen": "first time this task was seen, so there's nothing to compare",
  "no-change": "nothing visible changed",
  "alert-off": "this kind of alert is turned off for this chat",
};

export function skipReason(event, connection, settings = {}, previous = null) {
  const kind = eventKind(event, settings, previous);
  if (kind === "test" || !String(event.type).startsWith("task.")) return null;
  const audience = AUDIENCES[connection.only] ? connection.only : DEFAULT_AUDIENCE;
  const hasPeopleFields = ["assignedTo", "assignedToContact", "nextToDo"].some((k) => k in (event.data || {}));
  // A message event may not carry the task's people; then use the task's last known state.
  const now = event.type === "task.message.created" && !hasPeopleFields ? previous : snapshotOf(event.data);
  // Someone being taken off a task the chat followed is news too.
  const wasFollowed = kind === "task.updated" && matchesAudience(previous, audience);
  if (!matchesAudience(now, audience) && !wasFollowed) return "not-for-this-chat";
  if (kind === "task.updated" && !previous) return "first-seen";
  if (kind === "task.updated" && nothingChanged(previous, event.data)) return "no-change";
  if (ALERT_OF_KIND[kind] && !alertsOf(connection)[ALERT_OF_KIND[kind]]) return "alert-off";
  return null;
}

const ALERT_OF_KIND = {
  "task.created": "created",
  "task.assigned": "assigned",
  "task.completed": "completed",
  "task.message.created": "messages",
  "task.updated": "changes",
};

function personKey(p) {
  return p ? (p.email || p.name || "").toLowerCase() : "";
}

export function matchesAudience(snapshot, audience) {
  if (audience === "all") return true;
  if (!snapshot) return false;
  return Boolean(snapshot.assignee || (audience === "assigned-or-next" && snapshot.next));
}

// The message text for an event, or null when it isn't posted (see skipReason). For card events this is
// the card's heading.
export function buildMessage(event, connection, settings = {}, previous = null) {
  const kind = eventKind(event, settings, previous);
  if (kind === "test") return TEST_MESSAGE;
  if (skipReason(event, connection, settings, previous)) return null;
  const text = render(templateFor(connection, kind), event, settings, connection.platform, previous, kind);
  const info = EVENTS.find((e) => e.key === kind);
  return info?.card ? text.replace(/[*_]/g, "").trim() || info.fallback : text;
}

// What is sent to the chat: {text} or, for new / newly assigned / finished tasks in Google Chat,
// {text, cardsV2}. Slack gets the card's content as text. Null when nothing is posted.
export function buildPayload(event, connection, settings = {}, previous = null) {
  const text = buildMessage(event, connection, settings, previous);
  if (text === null) return null;
  const kind = eventKind(event, settings, previous);
  if (!EVENTS.find((e) => e.key === kind)?.card) return { text };
  const card = { header: text, ...cardFor(event, settings, connection.platform, previous, kind) };
  // Only a real @mention (the person's chat id is on file) goes above the card: it's what notifies them.
  const extras = extrasFor(event, settings, connection.platform, previous, kind);
  const mention = extras.assignee.startsWith("<") ? extras.assignee : "";
  if (connection.platform === "google-chat") {
    return mention ? { text: mention, cardsV2: [taskCard(card)] } : { cardsV2: [taskCard(card)] };
  }
  return { text: [mention, cardAsText(card)].filter(Boolean).join("\n") };
}

// A task card's context line, title, description and link.
export function cardFor(event, settings, platform, previous, kind) {
  return cardContent(extrasFor(event, settings, platform, previous, kind), kind, valueText(event.data?.status));
}

// A saved message still identical to an earlier default moves to the current default.
export function templateFor(connection, kind) {
  const fallback = EVENTS.find((e) => e.key === kind).template;
  const saved = connection.templates?.[kind];
  return saved == null || LEGACY_TEMPLATES[kind]?.includes(saved) ? fallback : saved;
}

function extrasFor(event, settings, platform, previous, kind) {
  const mentionOf = (person) => mentionFor(person, settings.people, platform);
  const link = taskUrl(event.data?.id, settings.taskUrl);
  return {
    ...taskExtras({ event, previous, kind: kind || eventKind(event, settings, previous), link, mentionOf }),
    mention: mentionOf(event.data?.assignedTo || event.data?.assignedToContact),
  };
}

export function render(template, event, settings = {}, platform = "google-chat", previous = null, kind = null) {
  const extras = extrasFor(event, settings, platform, previous, kind);
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

export function mentionFor(person, people = [], platform) {
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

export function taskUrl(id, template) {
  return template && id != null ? template.replace("{id}", encodeURIComponent(id)) : null;
}
