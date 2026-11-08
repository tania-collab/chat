// The summary: one card per chat, daily (weekday mornings) or weekly (Monday morning), listing the open tasks
// due in the coming days per person, overdue first. Each chat picks what it lists (summaryOf). The tasks come
// from zInspector (summary.js reads them) or, without an API key, from the tasks the app has seen.

import { DEFAULT_COMPLETED, mentionFor, taskUrl } from "./messages.js";
import { TIME_ZONE, localDate } from "./time.js";
export const SUMMARY_HOUR = 8;
const DASHBOARD = "https://dashboard.zinspector.com/";
const TASKS_PER_PERSON = 8;
const NOT_OPEN = ["canceled", "deferred"]; // finished in zInspector without being done
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SCHEDULES = {
  off: "Off",
  daily: "Daily, weekday mornings (8:30am Pacific)",
  weekly: "Weekly, Monday mornings (8:30am Pacific)",
};
export const SUMMARY_DAYS = [1, 3, 7, 14, 30];
export const MAX_PROPERTIES = 20;
export const SUMMARY_DEFAULTS = {
  schedule: "weekly",
  days: 7,
  onlyProperties: false,
  properties: [], // [{label, name, ids}]: a name ("Marketing.Comms", or "Marketing.BizDev*" for all that start so) and/or ids
  onlyDated: true,
  includeOverdue: true,
  onlyAssigned: true,
};

// A chat's summary settings. Chats from before the summary had the weekly digest on unless turned off.
export function summaryOf(connection) {
  const saved = connection.summary || {};
  const schedule = SCHEDULES[saved.schedule] ? saved.schedule : connection.alerts?.digest === false ? "off" : SUMMARY_DEFAULTS.schedule;
  return { ...SUMMARY_DEFAULTS, ...saved, schedule };
}

// True when a summary on this schedule is due: 8am hour Pacific (the cron runs at 15:30 and 16:30 UTC so one
// of them is 8:30 whether or not daylight saving is on), Monday to Friday for daily, Monday for weekly.
export function isSummaryTime(schedule, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (Number(parts.hour) !== SUMMARY_HOUR) return false;
  if (schedule === "weekly") return parts.weekday === "Mon";
  return schedule === "daily" && !["Sat", "Sun"].includes(parts.weekday);
}

// Whether a task is on one of the chosen properties: by id, exact name, or name start ("Marketing.BizDev*").
export function onProperties(task, properties) {
  const name = String(task.propertyName || "").toLowerCase();
  return properties.some((p) => {
    if ((p.ids || []).some((id) => String(id) === String(task.propertyId))) return true;
    const want = String(p.name || "").toLowerCase();
    if (!want || !name) return false;
    return want.endsWith("*") ? name.startsWith(want.slice(0, -1)) : name === want;
  });
}

// The tasks a chat's summary lists: open, then the chat's filters, then the due window.
export function selectTasks(tasks, summary, settings = {}, now = new Date()) {
  const today = localDate(now);
  const closed = new Set([...(settings.completedStatuses || DEFAULT_COMPLETED).split(","), ...NOT_OPEN].map((s) => s.trim().toLowerCase()));
  return tasks
    .filter((t) => !closed.has(String(t.status).toLowerCase()))
    .filter((t) => !summary.onlyProperties || onProperties(t, summary.properties))
    .filter((t) => !summary.onlyAssigned || t.assignee)
    .map((t) => ({ ...t, ...dueInfo(t.due, today) }))
    .filter((t) => {
      if (!t.dueDate) return !summary.onlyDated;
      if (t.overdue) return summary.includeOverdue;
      return t.daysLeft <= summary.days;
    });
}

// {text?, cardsV2} for Google Chat or {text} for Slack; null when there's nothing to list.
// `tasks` are task snapshots with their id; `pulse` adds last week's new / finished counts (weekly, seen tasks).
export function buildDigest(connection, tasks, settings = {}, now = new Date(), { pulse = false } = {}) {
  const summary = summaryOf(connection);
  const today = localDate(now);
  const open = selectTasks(tasks, summary, settings, now);
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const created = pulse ? tasks.filter((t) => t.createdAt && Date.parse(t.createdAt) >= weekAgo).length : 0;
  const finished = pulse ? tasks.filter((t) => t.finishedAt && Date.parse(t.finishedAt) >= weekAgo).length : 0;
  if (!open.length && !created && !finished) return null;

  const people = groupByPerson(open);
  const overdue = open.filter((t) => t.overdue).length;
  const coming = open.filter((t) => t.dueDate && !t.overdue).length;
  const weekly = summary.schedule === "weekly";
  const digest = {
    header: `${weekly ? `Week of ${formatDay(mondayOf(today), false)}` : longDay(today)} — ${connection.name}`,
    subtitle: [
      coming && `${coming} due ${summary.days === 1 ? "by tomorrow" : `in the next ${summary.days} days`}`,
      overdue && `${overdue} overdue`,
      open.length - coming - overdue && `${open.length - coming - overdue} with no due date`,
    ]
      .filter(Boolean)
      .join(" · "),
    people: people.map((p) => ({
      heading: `${p.name} — ${p.tasks.length} ${p.tasks.length === 1 ? "task" : "tasks"}${p.overdue ? ` (${p.overdue} overdue)` : ""}`,
      lines: p.tasks.slice(0, TASKS_PER_PERSON).map((t) => ({ title: titleOf(t), link: taskUrl(t.id, settings.taskUrl), note: noteOf(t) })),
      more: Math.max(0, p.tasks.length - TASKS_PER_PERSON),
    })),
    pulse: [
      pulse ? `Last week: ${created} new · ${finished} finished${finished ? " 🎉" : ""}` : "",
      open.length && !overdue && summary.includeOverdue ? "Nothing overdue 👏" : "",
    ]
      .filter(Boolean)
      .join("<br>"),
  };

  // @mention only the people with something overdue, and only those whose chat id is on file.
  const mentions = people
    .filter((p) => p.overdue && p.person?.email)
    .map((p) => mentionFor(p.person, settings.people, connection.platform))
    .filter((m) => m?.startsWith("<"));
  const nudge = mentions.length ? `${mentions.join(" ")} — you have overdue tasks` : "";

  if (connection.platform === "google-chat") {
    return nudge ? { text: nudge, cardsV2: [digestCard(digest)] } : { cardsV2: [digestCard(digest)] };
  }
  return { text: [nudge, digestText(digest)].filter(Boolean).join("\n") };
}

function digestCard(d) {
  const sections = d.people.map((p) => ({
    header: escapeHtml(p.heading),
    widgets: [{ textParagraph: { text: p.lines.map(lineHtml).concat(p.more ? [`and ${p.more} more`] : []).join("<br>") } }],
  }));
  const last = [{ buttonList: { buttons: [{ text: "Open zInspector", onClick: { openLink: { url: DASHBOARD } } }] } }];
  if (d.pulse) last.unshift({ textParagraph: { text: d.pulse.split("<br>").map(escapeHtml).join("<br>") } });
  sections.push({ widgets: last });
  const header = d.subtitle ? { title: d.header, subtitle: d.subtitle } : { title: d.header };
  return { cardId: "digest", card: { header, sections } };
}

function digestText(d) {
  const people = d.people.flatMap((p) => [
    `*${p.heading}*`,
    ...p.lines.map((l) => `• ${l.link ? `<${l.link}|${l.title}>` : l.title}${l.note ? ` · ${l.note}` : ""}`),
    ...(p.more ? [`and ${p.more} more`] : []),
  ]);
  const pulse = d.pulse ? d.pulse.split("<br>") : [];
  return [`*${d.header}*`, d.subtitle, "", ...people, "", ...pulse, `<${DASHBOARD}|Open zInspector>`].filter((l, i) => l || i > 1).join("\n");
}

function lineHtml(l) {
  const title = l.link ? `<a href="${escapeHtml(l.link)}">${escapeHtml(l.title)}</a>` : escapeHtml(l.title);
  return `• ${title}${l.note ? ` · ${escapeHtml(l.note)}` : ""}`;
}

// "due Wed · In Progress": when, and the status once the task has moved past New.
function noteOf(t) {
  return [t.note, t.status && !/^new$/i.test(t.status) ? t.status : ""].filter(Boolean).join(" · ");
}

// People with the most overdue, then the most tasks, first; each person's tasks overdue first, then by due
// date, then undated.
function groupByPerson(open) {
  const byName = new Map();
  for (const t of open) {
    const person = t.assignee || (t.next ? { name: t.next } : null);
    const name = person?.name || "Unassigned";
    if (!byName.has(name)) byName.set(name, { name, person: t.assignee, tasks: [] });
    byName.get(name).tasks.push(t);
  }
  const order = (t) => (t.overdue ? 0 : t.dueDate ? 1 : 2);
  return [...byName.values()]
    .map((p) => ({
      ...p,
      overdue: p.tasks.filter((t) => t.overdue).length,
      tasks: p.tasks.sort((a, b) => order(a) - order(b) || String(a.dueDate).localeCompare(String(b.dueDate))),
    }))
    .sort((a, b) => b.overdue - a.overdue || b.tasks.length - a.tasks.length || a.name.localeCompare(b.name));
}

function dueInfo(due, today) {
  const dueDate = String(due || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { dueDate: "", overdue: false, daysLeft: null, note: "" };
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  const base = { dueDate, overdue: days < 0, daysLeft: days };
  if (days < 0) return { ...base, note: `overdue since ${formatDay(dueDate, days >= -6)}` };
  if (days === 0) return { ...base, note: "due today" };
  if (days === 1) return { ...base, note: "due tomorrow" };
  return { ...base, note: `due ${formatDay(dueDate, days <= 6)}` };
}

// "Fri" when it's within the week, else "Oct 26".
function formatDay(ymd, weekdayOnly) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return weekdayOnly ? WEEKDAYS[d.getUTCDay()] : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// "Mon, Nov 9".
function longDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// The Monday of the week a date is in (YYYY-MM-DD).
function mondayOf(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

function titleOf(t) {
  const first = String(t.description || "").split("\n")[0].trim();
  return (first.length > 70 ? first.slice(0, 69) + "…" : first) || t.type || "Task";
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
