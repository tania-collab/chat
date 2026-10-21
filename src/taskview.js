// What a task looks like to the chat: its last known state, what changed since, and ready-made
// template values ({{taskTitle}}, {{assignee}}, {{changes}}, ...).

const PRIORITY = { 1: "Lowest", 2: "Low", 3: "Normal", 4: "High", 5: "Highest" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_TEXT = 280;

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
    lines.push(`• Description: _${shorten(now.description, 140)}_`);
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
  const mentionAssignee = kind !== "task.updated" || newlyAssigned;
  const assignee = now.assignee ? (mentionAssignee ? mentionOf(now.assignee) : `*${now.assignee.name}*`) : "";
  const title = now.type || "Task";

  if (!previous && kind === "task.updated") {
    // First time this task is seen: no history to compare, so say where it stands.
    if (now.status) changes.push(`• Status: *${now.status}*`);
    if (assignee) changes.push(`• Assigned: ${assignee}`);
  }
  return {
    taskTitle: link ? `<${link}|${title}>` : `*${title}*`,
    taskLink: link || "",
    assignee,
    assigneeOrUnassigned: assignee || "_Unassigned_",
    changes: changes.join("\n"),
    previousStatus: previous?.status || "",
    dueDate: formatDate(now.due),
    priorityFlag: priorityFlag(now.priority),
    shortDescription: shorten(now.description, SHORT_TEXT),
    messageText: shorten(cleanMessage(messageBody(data)), SHORT_TEXT),
    messageAuthor: text(pick(data, ["author", "message.author", "createdBy", "message.createdBy", "from", "message.from", "authorName", "commentedBy"])),
  };
}

export const EXTRA_NAMES = [
  "taskTitle", "assignee", "assigneeOrUnassigned", "changes", "dueDate", "priorityFlag",
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
