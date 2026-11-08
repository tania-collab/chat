// The summary: one message per chat on the days and hour it chooses, listing the open tasks by urgency. Each chat picks what it lists (summaryOf). The tasks come
// from zInspector (summary.js reads them) or, without an API key, from the tasks the app has seen.

import { DEFAULT_COMPLETED, mentionFor, taskUrl } from "./messages.js";
import { TIME_ZONE, localDate } from "./time.js";
const DASHBOARD = "https://dashboard.zinspector.com/";
const TASKS_PER_SECTION = 10;
const QUIET_SHOWN = 8;
const SECTIONS = {
  overdue: "*🔴 Past due.* What's one small step that would move each of these forward?",
  coming: "*🗓️ Coming up.* Here's what's next on the calendar:",
  undated: "*📅 No date yet.* When should these be done?",
  quiet: "*💤 Gone quiet.* Still on your radar?",
};
const NOT_OPEN = ["canceled", "deferred"]; // finished in zInspector without being done
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// When a chat's summary is posted: on these weekdays (none = off), at this hour and 30 minutes, Pacific time.
export const POST_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const POST_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
// How many days ahead "coming up" looks.
export const MAX_DAYS_AHEAD = 60;
// How far back overdue tasks are listed (0 = all), so tasks forgotten long ago don't fill the list.
export const OVERDUE_WITHIN = [7, 30, 90, 0];
// "Going quiet": open tasks with no activity for this many days (0 = off), whatever their due date.
export const QUIET_DAYS = [7, 14, 30, 60, 0];
export const MAX_PROPERTIES = 20;
// Whose tasks the summary lists; each task goes under the first of these people it has.
export const OWNERS = {
  assigned: "Assigned only",
  "assigned-or-next": "Assigned, or the next to-do",
  anyone: "Assigned, next to-do, or the manager",
};
export const SUMMARY_DEFAULTS = {
  postDays: ["Mon"],
  hour: 8,
  days: 7,
  onlyProperties: false,
  properties: [], // [{label, name, ids}]: a name ("Marketing.Comms", or "Marketing.BizDev*" for all that start so) and/or ids
  onlyDated: true,
  includeOverdue: true,
  overdueWithin: 30,
  quietDays: 14,
  owners: "assigned-or-next",
  intro: "", // the opening line; empty = DEFAULT_INTRO for the schedule
};

// A chat's summary settings. Chats from before the summary had the weekly digest on unless turned off.
export function summaryOf(connection) {
  const { onlyAssigned, schedule, ...saved } = connection.summary || {};
  // Before the days were chosen one by one, a summary was daily (weekdays), weekly (Mondays) or off.
  const fromSchedule = { daily: POST_DAYS.slice(0, 5), weekly: ["Mon"], off: [] }[schedule];
  const postDays = Array.isArray(saved.postDays)
    ? saved.postDays
    : fromSchedule || (connection.alerts?.digest === false ? [] : SUMMARY_DEFAULTS.postDays);
  // "Only tasks with someone assigned" was a checkbox before the owners choice.
  const owners = OWNERS[saved.owners] ? saved.owners : onlyAssigned === true ? "assigned" : onlyAssigned === false ? "anyone" : SUMMARY_DEFAULTS.owners;
  return { ...SUMMARY_DEFAULTS, ...saved, postDays, owners };
}

// True when a chat's summary is due: one of its days, in its hour, Pacific time (the cron runs every hour at
// :30, so a summary goes out at 8:30 for hour 8).
export function isSummaryTime(summary, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return summary.postDays.includes(parts.weekday) && Number(parts.hour) % 24 === summary.hour;
}

// "Weekdays at 8:30am", "Mondays at 8:30am", "Mon, Wed, Fri at 2:30pm", or "Off".
export function describeSchedule(summary) {
  const days = summary.postDays;
  if (!days.length) return "Off";
  const when = days.length === 7 ? "Every day" : days.join() === POST_DAYS.slice(0, 5).join() ? "Weekdays" : days.length === 1 ? `${days[0]}days` : days.join(", ");
  return `${when.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)days$/, (m, d) => ({ Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" })[d])} at ${hourLabel(summary.hour)}`;
}

export function hourLabel(hour) {
  return `${hour % 12 || 12}:30${hour < 12 ? "am" : "pm"}`;
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
  return followed(tasks, summary, settings, now).filter((t) => {
      if (!t.dueDate) return !summary.onlyDated;
      if (t.overdue) return summary.includeOverdue && (!summary.overdueWithin || -t.daysLeft <= summary.overdueWithin);
      return t.daysLeft <= summary.days;
    });
}

// Open tasks the chat follows (properties, owners), with their due info, before the due-date filters.
function followed(tasks, summary, settings, now) {
  const today = localDate(now);
  const closed = new Set([...(settings.completedStatuses || DEFAULT_COMPLETED).split(","), ...NOT_OPEN].map((s) => s.trim().toLowerCase()));
  return tasks
    .filter((t) => !closed.has(String(t.status).toLowerCase()))
    .filter((t) => !summary.onlyProperties || onProperties(t, summary.properties))
    .map((t) => ({ ...t, owner: ownerOf(t, summary.owners) }))
    .filter((t) => t.owner)
    .map((t) => ({ ...t, ...dueInfo(t.due, today) }));
}

// Followed tasks with no activity for the chat's quietDays or more, oldest first: the closest thing to a missed
// deadline on tasks without one. `listed` (ids already in the due list) are left out.
export function selectQuiet(tasks, summary, settings = {}, now = new Date(), listed = new Set()) {
  if (!summary.quietDays) return [];
  return followed(tasks, summary, settings, now)
    .filter((t) => !listed.has(t.id) && t.lastActivity)
    .map((t) => ({ ...t, quietDays: Math.floor((now.getTime() - Date.parse(t.lastActivity)) / DAY_MS) }))
    .filter((t) => t.quietDays >= summary.quietDays)
    .map((t) => ({ ...t, quiet: true }));
}

// The summary as one chat message (text, so people can be @mentioned: chat cards can't), or null when there's
// nothing to list. `tasks` are task snapshots with their id; `pulse` adds last week's new / finished counts
// (weekly, seen tasks).
export function buildDigest(connection, tasks, settings = {}, now = new Date(), { pulse = false, preview = false } = {}) {
  const summary = summaryOf(connection);
  const today = localDate(now);
  const due = selectTasks(tasks, summary, settings, now);
  const quiet = selectQuiet(tasks, summary, settings, now, new Set(due.map((t) => t.id)));
  const open = [...due, ...quiet];
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const created = pulse ? tasks.filter((t) => t.createdAt && Date.parse(t.createdAt) >= weekAgo).length : 0;
  const finished = pulse ? tasks.filter((t) => t.finishedAt && Date.parse(t.finishedAt) >= weekAgo).length : 0;
  if (!open.length) return null;

  // The preview shows who is @mentioned by name (a chat id means nothing on the settings page).
  const tag = (person) => {
    const m = mentionFor(person, settings.people, connection.platform) || "*Unassigned*";
    return preview && m.startsWith("<") ? `@@${person.name}@@` : m;
  };
  const overdue = due.filter((t) => t.overdue).length;
  const coming = due.filter((t) => t.dueDate && !t.overdue).length;
  const undated = due.length - coming - overdue;
  const values = {
    "Chat name": connection.name,
    Day: longDay(today),
    Week: formatDay(mondayOf(today), false),
    Days: String(summary.days),
    "Due count": String(coming),
    "Overdue count": String(overdue),
  };
  // The default opening and closing lines rotate by day, so the summary doesn't read the same every morning;
  // Mondays get the start-of-the-week ones.
  const weekly = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()] === "Mon";
  const openers = weekly ? DEFAULT_INTRO.weekly : summary.hour >= 12 ? DEFAULT_INTRO.afternoon : DEFAULT_INTRO.daily;
  const intro = fill(summary.intro || rotate(openers, today), values);
  const counts = [
    coming && `${coming} coming up ${summary.days === 1 ? "by tomorrow" : `in the next ${summary.days} days`}`,
    overdue && `${overdue} past due`,
    undated && `${undated} without a date`,
    quiet.length && `${quiet.length} gone quiet`,
  ].filter(Boolean);

  // One list of tasks, by urgency; each task tags the people on it.
  const line = (t) => taskLine(t, taskUrl(t.id, settings.taskUrl), tag);
  const byDue = (x, y) => String(x.dueDate).localeCompare(String(y.dueDate));
  const groups = [
    [SECTIONS.overdue, due.filter((t) => t.overdue).sort(byDue), TASKS_PER_SECTION],
    [SECTIONS.coming, due.filter((t) => t.dueDate && !t.overdue).sort(byDue), TASKS_PER_SECTION],
    [SECTIONS.undated, due.filter((t) => !t.dueDate), TASKS_PER_SECTION],
    [SECTIONS.quiet, quiet.sort((x, y) => y.quietDays - x.quietDays), QUIET_SHOWN],
  ];
  const sections = groups
    .filter(([, list]) => list.length)
    .map(([heading, list, max]) =>
      [heading, ...list.slice(0, max).map(line), list.length > max ? `   _…and ${list.length - max} more_` : ""].filter(Boolean).join("\n"),
    );
  const footer = [
    pulse ? `Last week the team opened ${created} and wrapped up ${finished}${finished ? " 🎉" : ""}` : "",
    due.length && !overdue && summary.includeOverdue ? "Nothing past due. Love to see it 🙌" : "",
    rotate(weekly ? CLOSERS.weekly : CLOSERS.daily, today),
    `<${DASHBOARD}|Open zInspector →>`,
  ].filter(Boolean);
  const text = [intro, counts.length ? `_${counts.join(" · ")}_` : "", ...sections, footer.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  return { text };
}

// The summary's opening lines, one a day in turn; [Chat name], [Day], [Week], [Days], [Due count] and
// [Overdue count] are filled in. A chat can set its own instead.
export const DEFAULT_INTRO = {
  daily: [
    "☀️ *Good morning, [Chat name]!* Here's what's on deck today, plus a few things that could use a little love 👇",
    "☕ *Morning, [Chat name]!* Curious what today holds? Here's where things stand 👇",
    "👋 *Hey [Chat name]!* Fresh day, fresh momentum. Here's your lineup 👇",
  ],
  afternoon: [
    "🌤️ *Afternoon, [Chat name]!* Here's a quick look at where things stand 👇",
    "👋 *Hey [Chat name]!* Quick check-in before the day wraps up 👇",
  ],
  weekly: [
    "👋 *Happy Monday, [Chat name]!* New week, clean slate. Here's what's coming up 👇",
    "🌱 *Hello [Chat name], and happy Monday!* Here's the week of [Week] at a glance 👇",
  ],
};
// The closing question, one a day in turn: an invitation to reply in the thread, not just read.
export const CLOSERS = {
  daily: [
    "💬 What's one thing you'll move forward today? Drop it in the thread!",
    "🎉 Already wrapped something up? Share it here. Wins are contagious.",
    "🤔 Anything stuck? Ask in the thread. Someone here might have the key.",
  ],
  weekly: [
    "💬 What's the one task that would make this week a win? Share it in the thread!",
    "🙌 Who could use a hand this week? Say so in the thread, no task is too small.",
  ],
};

// One of `list` per day (Pacific), in turn.
function rotate(list, ymd) {
  return list[Math.round(Date.parse(ymd) / DAY_MS) % list.length];
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
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

// "🔴 <link|Title> — 3 days past due · @Tim, with @Laura up next · In Progress": a dot for how soon, the title
// linked, when, the people on the task (assignee, next to-do, or the manager when it's theirs), and the status
// once past New.
function taskLine(t, link, tag) {
  const title = titleOf(t).replace(/[<>|]/g, " ");
  const dot = t.quiet ? "💤" : t.overdue ? "🔴" : t.daysLeft != null && t.daysLeft <= 1 ? "🟠" : t.dueDate ? "🔹" : "▫️";
  const when = t.quiet ? `untouched for ${quietFor(t.quietDays)}` : t.note;
  const status = t.status && !/^new$/i.test(t.status) ? t.status : "";
  return [`${dot} ${link ? `<${link}|${title}>` : `*${title}*`}`, [when, peopleOn(t, tag), status].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join(" — ");
}

// Who to tag on a task line, in words: "@Tim", "@Tim, with @Laura up next", "@Laura, your move",
// "@Athina, you're steering this one".
function peopleOn(t, tag) {
  const next = t.nextPerson || (t.next ? { name: t.next } : null);
  if (t.assignee) return next?.name && next.name !== t.assignee.name ? `${tag(t.assignee)}, with ${tag(next)} up next` : tag(t.assignee);
  if (t.owner?.role === "next") return `${tag(t.owner.person)}, your move`;
  if (t.owner?.role === "manager") return `${tag(t.owner.person)}, you're steering this one`;
  return "";
}

// "9 days", "3 weeks", "4 months".
function quietFor(days) {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

function dueInfo(due, today) {
  const dueDate = String(due || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { dueDate: "", overdue: false, daysLeft: null, note: "" };
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  const base = { dueDate, overdue: days < 0, daysLeft: days };
  if (days < 0) return { ...base, note: days === -1 ? "1 day past due" : `${-days} days past due` };
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

