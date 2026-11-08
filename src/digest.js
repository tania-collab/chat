// The summary: one message per chat, daily (weekday mornings) or weekly (Monday morning), listing the open tasks
// due in the coming days per person, overdue first. Each chat picks what it lists (summaryOf). The tasks come
// from zInspector (summary.js reads them) or, without an API key, from the tasks the app has seen.

import { DEFAULT_COMPLETED, mentionFor, taskUrl } from "./messages.js";
import { TIME_ZONE, localDate } from "./time.js";
export const SUMMARY_HOUR = 8;
const DASHBOARD = "https://dashboard.zinspector.com/";
const TASKS_PER_PERSON = 10;
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
// How far back overdue tasks are listed (0 = all), so tasks forgotten long ago don't fill the list.
export const OVERDUE_WITHIN = [7, 30, 90, 0];
export const MAX_PROPERTIES = 20;
// Whose tasks the summary lists; each task goes under the first of these people it has.
export const OWNERS = {
  assigned: "Assigned only",
  "assigned-or-next": "Assigned, or the next to-do",
  anyone: "Assigned, next to-do, or the manager",
};
export const SUMMARY_DEFAULTS = {
  schedule: "weekly",
  days: 7,
  onlyProperties: false,
  properties: [], // [{label, name, ids}]: a name ("Marketing.Comms", or "Marketing.BizDev*" for all that start so) and/or ids
  onlyDated: true,
  includeOverdue: true,
  overdueWithin: 30,
  owners: "assigned-or-next",
  intro: "", // the opening line; empty = DEFAULT_INTRO for the schedule
};

// A chat's summary settings. Chats from before the summary had the weekly digest on unless turned off.
export function summaryOf(connection) {
  const { onlyAssigned, ...saved } = connection.summary || {};
  const schedule = SCHEDULES[saved.schedule] ? saved.schedule : connection.alerts?.digest === false ? "off" : SUMMARY_DEFAULTS.schedule;
  // "Only tasks with someone assigned" was a checkbox before the owners choice.
  const owners = OWNERS[saved.owners] ? saved.owners : onlyAssigned === true ? "assigned" : onlyAssigned === false ? "anyone" : SUMMARY_DEFAULTS.owners;
  return { ...SUMMARY_DEFAULTS, ...saved, schedule, owners };
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
    .map((t) => ({ ...t, owner: ownerOf(t, summary.owners) }))
    .filter((t) => t.owner)
    .map((t) => ({ ...t, ...dueInfo(t.due, today) }))
    .filter((t) => {
      if (!t.dueDate) return !summary.onlyDated;
      if (t.overdue) return summary.includeOverdue && (!summary.overdueWithin || -t.daysLeft <= summary.overdueWithin);
      return t.daysLeft <= summary.days;
    });
}

// The summary as one chat message (text, so people can be @mentioned: chat cards can't), or null when there's
// nothing to list. `tasks` are task snapshots with their id; `pulse` adds last week's new / finished counts
// (weekly, seen tasks).
export function buildDigest(connection, tasks, settings = {}, now = new Date(), { pulse = false, preview = false } = {}) {
  const summary = summaryOf(connection);
  const today = localDate(now);
  const open = selectTasks(tasks, summary, settings, now);
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const created = pulse ? tasks.filter((t) => t.createdAt && Date.parse(t.createdAt) >= weekAgo).length : 0;
  const finished = pulse ? tasks.filter((t) => t.finishedAt && Date.parse(t.finishedAt) >= weekAgo).length : 0;
  if (!open.length) return null;

  // The preview shows who is @mentioned by name (a chat id means nothing on the settings page).
  const tag = (person) => {
    const m = mentionFor(person, settings.people, connection.platform) || "*Unassigned*";
    return preview && m.startsWith("<") ? `@@${person.name}@@` : m;
  };
  const overdue = open.filter((t) => t.overdue).length;
  const coming = open.filter((t) => t.dueDate && !t.overdue).length;
  const undated = open.length - coming - overdue;
  const values = {
    "Chat name": connection.name,
    Day: longDay(today),
    Week: formatDay(mondayOf(today), false),
    Days: String(summary.days),
    "Due count": String(coming),
    "Overdue count": String(overdue),
  };
  const intro = fill(summary.intro || DEFAULT_INTRO[summary.schedule] || DEFAULT_INTRO.daily, values);
  const counts = [
    coming && `${coming} due ${summary.days === 1 ? "by tomorrow" : `in the next ${summary.days} days`}`,
    overdue && `${overdue} overdue`,
    undated && `${undated} with no due date`,
  ].filter(Boolean);

  const sections = groupByPerson(open).map((p) => {
    const lines = p.tasks.slice(0, TASKS_PER_PERSON).map((t) => taskLine(t, taskUrl(t.id, settings.taskUrl), tag));
    if (p.tasks.length > TASKS_PER_PERSON) lines.push(`   _and ${p.tasks.length - TASKS_PER_PERSON} more_`);
    const size = `${p.tasks.length} ${p.tasks.length === 1 ? "task" : "tasks"}${p.overdue ? `, ${p.overdue} overdue` : ""}`;
    return [`${p.person ? tag(p.person) : `*${p.name}*`} · ${size}`, ...lines].join("\n");
  });
  const footer = [
    pulse ? `Last week: ${created} new · ${finished} finished${finished ? " 🎉" : ""}` : "",
    open.length && !overdue && summary.includeOverdue ? "Nothing overdue 👏" : "",
    `<${DASHBOARD}|Open zInspector>`,
  ].filter(Boolean);
  const text = [intro, counts.length ? `_${counts.join(" · ")}_` : "", ...sections, footer.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  return { text };
}

// The summary's opening line; [Chat name], [Day], [Week], [Days], [Due count] and [Overdue count] are filled in.
export const DEFAULT_INTRO = {
  daily: "☀️ *Good morning, [Chat name]!* Here's what's coming up ([Day])",
  weekly: "👋 *Happy Monday, [Chat name]!* Here's the week of [Week]",
};
export const INTRO_DETAILS = ["Chat name", "Day", "Week", "Days", "Due count", "Overdue count"];

function fill(template, values) {
  return String(template).replace(/\[([^\]]+)\]/g, (m, k) => (Object.hasOwn(values, k) ? values[k] : m));
}

// Who a task is listed under, and why: {person, role}; null when nobody fits the chat's owners choice.
export function ownerOf(t, owners) {
  const next = t.nextPerson || (t.next ? { name: t.next } : null);
  if (t.assignee) return { person: t.assignee, role: "assigned" };
  if (owners !== "assigned" && next?.name) return { person: next, role: "next" };
  if (owners === "anyone" && t.manager?.name) return { person: t.manager, role: "manager" };
  return null;
}

// "🔴 <link|Title> — 3 days overdue · In Progress · next: @Laura": a colored dot for how soon, the title linked,
// when, the status once past New, and who has the next to-do when that's someone else.
function taskLine(t, link, tag) {
  const title = titleOf(t).replace(/[<>|]/g, " ");
  const dot = t.overdue ? "🔴" : t.daysLeft != null && t.daysLeft <= 1 ? "🟠" : t.dueDate ? "🔹" : "▫️";
  const nextPerson = t.nextPerson || (t.next ? { name: t.next } : null);
  const nextIsOther = nextPerson?.name && nextPerson.name !== t.assignee?.name;
  const role = t.owner?.role === "next" ? "you're next" : t.owner?.role === "manager" ? "you manage it" : "";
  const extra = [t.status && !/^new$/i.test(t.status) ? t.status : "", nextIsOther && t.assignee ? `next: ${tag(nextPerson)}` : "", role];
  return [`${dot} ${link ? `<${link}|${title}>` : `*${title}*`}`, [t.note, ...extra].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
}

// People with the most overdue, then the most tasks, first; each person's tasks overdue first, then by due
// date, then undated.
function groupByPerson(open) {
  const byName = new Map();
  for (const t of open) {
    const person = t.owner?.person || null;
    const name = person?.name || "Unassigned";
    if (!byName.has(name)) byName.set(name, { name, person, tasks: [] });
    else if (!byName.get(name).person?.email && person?.email) byName.get(name).person = person;
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
  if (days < 0) return { ...base, note: days === -1 ? "overdue since yesterday" : `${-days} days overdue` };
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

