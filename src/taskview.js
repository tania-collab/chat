// What a task looks like to the chat: its last known state, what changed since, and ready-made
// template values ({{taskTitle}}, {{assignee}}, {{changes}}, ...).

import { daysFromToday } from "./time.js";

const PRIORITY = { 1: "Lowest", 2: "Low", 3: "Normal", 4: "High", 5: "Highest" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_TEXT = 280;
const TITLE_MAX = 90;

// The fields worth comparing between two events of the same task.
export function snapshotOf(data = {}) {
  const person = data.assignedTo || data.assignedToContact || null;
  return {
    status: text(data.status),
    assignee: person ? { name: text(person.name ?? person), email: person.email || "" } : null,
    priority: data.priority ?? null,
    due: data.endDate || null,
    start: data.startDate || null,
    type: text(data.type),
    description: text(data.description).slice(0, 500),
    next: text(data.nextToDo?.name ?? data.nextToDo),
  };
}

// Bullet lines describing what changed; [] when nothing visible did.
export function changesBetween(before, now, mentionOf) {
  if (!before) return [];
  const lines = [];
  if (before.status !== now.status) lines.push(`• Status: ${before.status || "none"} → *${now.status}*`);
  if (personKey(before.assignee) !== personKey(now.assignee)) {
    lines.push(
      now.assignee
        ? `• Assigned: ${before.assignee ? before.assignee.name + " → " : ""}${mentionOf(now.assignee)}`
        : `• Unassigned (was ${before.assignee.name})`,
    );
  }
  dateChange(lines, "Due", before.due, now.due);
  dateChange(lines, "Start", before.start, now.start);
  if (before.priority !== now.priority && now.priority != null) {
    lines.push(`• Priority: ${priorityName(before.priority) || "none"} → *${priorityName(now.priority)}*`);
  }
  if (before.type !== now.type && now.type) lines.push(`• Type: ${before.type || "none"} → *${now.type}*`);
  if (before.next !== now.next && now.next) lines.push(`• Next to-do: *${now.next}*`);
  if (before.description !== now.description && now.description) {
    lines.push(`• Title: _${shorten(now.description, 140)}_`);
  }
  return lines;
}

// Ready-made values for templates. `kind` decides when the assignee is @mentioned:
// on a new task, a completion, or when they were just assigned, never on every update.
export function taskExtras({ event, previous, kind, link, mentionOf }) {
  const data = event.data || {};
  const now = snapshotOf(data);
  const changes = changesBetween(previous, now, mentionOf);
  const newlyAssigned = previous && personKey(previous.assignee) !== personKey(now.assignee);
  // @mention when the person has something to do: a new task or one just given to them. Not when they
  // finished it, and not on every update.
  const mentionAssignee = kind === "task.created" || kind === "task.assigned" || (kind === "task.updated" && newlyAssigned);
  const assignee = now.assignee ? (mentionAssignee ? mentionOf(now.assignee) : `*${now.assignee.name}*`) : "";
  // zInspector shows a task's description as its title; the type ("Marketing Required") is its category.
  const typeLabel = now.type.replace(/ Required$/, "");
  const title = shorten(now.description.split("\n")[0], TITLE_MAX) || typeLabel || "Task";
  const linkText = title.replace(/[<>|]/g, " ").replace(/\s+/g, " ").trim(); // these would break <url|text>

  return {
    taskTitle: link ? `<${link}|${linkText}>` : `*${title}*`,
    taskType: typeLabel,
    plainTitle: title,
    shortTitle: shorten(title, 50),
    // " from Tania", for {{fromManager?}}; empty when there's no manager or they gave it to themselves.
    fromManager: sameName(data.manager, now.assignee) || !text(data.manager) ? "" : ` from ${firstName(text(data.manager))}`,
    // " — 2 days early 🚀", " — right on time ✅", " — 1 day late"; empty without a due date.
    finishTiming: finishTiming(now.due),
    area: shortArea(data.propertyName),
    // No "from Tania" on a task Tania gave herself.
    managerName: sameName(data.manager, now.assignee) ? "" : firstName(text(data.manager)),
    dueLabel: dueLabel(now.due),
    dueTone: dueTone(now.due),
    priorityLabel: `${PRIORITY[now.priority] || "Normal"} priority`,
    priorityTone: now.priority >= 5 ? "highest" : now.priority === 4 ? "high" : now.priority != null && now.priority <= 2 ? "low" : "normal",
    finishLabel: finishLabel(now.status, now.due),
    assigneeFirstName: firstName(now.assignee?.name),
    // The rest of the description, when the title above had to cut it short.
    descriptionMore: shorten(now.description, SHORT_TEXT) === title ? "" : shorten(now.description, SHORT_TEXT),
    taskLink: link || "",
    assignee,
    assigneeOrUnassigned: assignee || "_Unassigned_",
    changes: changes.join("\n"),
    previousStatus: previous?.status || "",
    dueDate: formatDue(now.due),
    priorityFlag: priorityFlag(now.priority),
    shortDescription: shorten(now.description, SHORT_TEXT),
    messageText: shorten(cleanMessage(messageBody(data)), SHORT_TEXT),
    messageAuthor: text(pick(data, ["author", "message.author", "createdBy", "message.createdBy", "from", "message.from", "authorName", "commentedBy"])),
  };
}

export const EXTRA_NAMES = [
  "taskTitle", "shortTitle", "fromManager", "finishTiming", "taskType", "descriptionMore", "managerName", "area", "assigneeFirstName", "assignee", "assigneeOrUnassigned", "changes", "dueDate", "priorityFlag",
  "shortDescription", "messageText", "messageAuthor", "previousStatus", "taskLink", "mention",
];

// True when a task.updated changed nothing worth posting.
export function nothingChanged(previous, data) {
  return Boolean(previous) && changesBetween(previous, snapshotOf(data), () => "").length === 0;
}

function dateChange(lines, label, before, now) {
  const b = formatDate(before);
  const n = formatDate(now);
  if (b === n) return;
  if (!n) lines.push(`• ${label} date removed`);
  else lines.push(`• ${label}: ${b ? b + " → " : ""}*${n}*`);
}

function priorityName(p) {
  return p == null ? "" : PRIORITY[p] || String(p);
}

function priorityFlag(p) {
  if (p >= 4) return `🔺 ${PRIORITY[p] || "High"} priority`;
  if (p != null && p <= 2) return `${PRIORITY[p] || "Low"} priority`;
  return "";
}

// "2026-10-30" or "2026-10-30T17:00:00Z" → "Oct 30" (with the year when it isn't this year).
function formatDate(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const year = Number(m[1]) === new Date().getUTCFullYear() ? "" : `, ${m[1]}`;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${year}`;
}

// "Due tomorrow", "Due in 3 days", "⚠️ Overdue by 2 days"; a date when it's more than a week away.
function dueLabel(due) {
  const days = daysFromToday(due);
  if (days === null) return "";
  if (days < 0) return `⚠️ Overdue by ${plural(-days, "day")}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 6) return `Due in ${days} days`;
  return `Due ${formatDate(due)}`;
}

// How urgent a due date is, for the card's colors: overdue, soon (today or tomorrow), later, none.
function dueTone(due) {
  const days = daysFromToday(due);
  if (days === null) return "none";
  return days < 0 ? "overdue" : days <= 1 ? "soon" : "later";
}

function finishTiming(due) {
  const days = daysFromToday(due);
  if (days === null) return "";
  if (days > 0) return ` — ${plural(days, "day")} early 🚀`;
  if (days === 0) return " — right on time ✅";
  return ` — ${plural(-days, "day")} late`;
}

// "Done · 2 days early", "Closed · on time", "Done · 3 days late"; just the status without a due date.
function finishLabel(status, due) {
  const word = /^work complete$/i.test(status) ? "Done" : status;
  const days = daysFromToday(due);
  if (days === null) return word;
  const timing = days > 0 ? `${plural(days, "day")} early` : days === 0 ? "on time" : `${plural(-days, "day")} late`;
  return [word, timing].filter(Boolean).join(" · ");
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function sameName(a, b) {
  const key = (p) => (p ? String(p.email || p.name || "").toLowerCase().replace(/\+[^@]*(?=@)/, "") : "");
  return Boolean(a && b) && key(a) === key(b);
}

// "Fri, Oct 30", or "today".
function formatDue(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) return "today";
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getUTCDay()]}, ${formatDate(v)}`;
}

// "Marketing.BizDev.Company" → "BizDev / Company", "Marketing.01.Inbox" → "Inbox".
function shortArea(property) {
  const parts = String(property || "").split(".").filter((p) => p && !/^\d+$/.test(p));
  return (parts.length > 1 ? parts.slice(1) : parts).join(" / ");
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function messageBody(data) {
  const v = pick(data, ["message.body_text", "message.bodyText", "message.text", "message.body", "message", "comment", "body_text", "bodyText", "body", "text", "content"]);
  return typeof v === "string" ? v : "";
}

// Plain text of an email-like message, without quoted replies or signatures.
function cleanMessage(s) {
  const plain = s
    .replace(/<(br|\/p|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/­/g, "");
  const cut = plain.split(/\n\s*(--\s*$|On .+ wrote:|Sent from |From: |_{5,})/m)[0];
  return cut.replace(/\s+/g, " ").trim();
}

function shorten(s, max) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(" ", max) > max * 0.6 ? s.lastIndexOf(" ", max) : max).trim() + "…";
}

function pick(obj, paths) {
  for (const path of paths) {
    const v = path.split(".").reduce((o, k) => (o != null && typeof o === "object" && Object.hasOwn(o, k) ? o[k] : undefined), obj);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function personKey(p) {
  return p ? (p.email || p.name || "").toLowerCase() : "";
}

function text(v) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  return String(v.value ?? v.name ?? "");
}
