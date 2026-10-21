// The weekly digest: Monday morning, one card per chat with what's open per person (overdue first), what's
// due this week, and last week's new / finished counts. Built from the tasks the app has seen.

import { DEFAULT_AUDIENCE, DEFAULT_COMPLETED, matchesAudience, mentionFor, taskUrl } from "./messages.js";
import { TIME_ZONE, localDate } from "./time.js";
export const DIGEST_DAY = "Mon";
export const DIGEST_HOUR = 8;
const DASHBOARD = "https://dashboard.zinspector.com/";
const TASKS_PER_PERSON = 5;
const NOT_OPEN = ["canceled", "deferred"]; // finished in zInspector without being done
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// True during the digest hour on the digest day, Pacific time (the cron runs at both 15:30 and 16:30 UTC
// so one of them is 8:30 whether or not daylight saving is on).
export function isDigestTime(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return parts.weekday === DIGEST_DAY && Number(parts.hour) === DIGEST_HOUR;
}

// {text?, cardsV2} for Google Chat or {text} for Slack; null when the chat has nothing open and a quiet week.
export function buildDigest(connection, activity, settings = {}, now = new Date()) {
  const today = localDate(now);
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const rule = connection.only || DEFAULT_AUDIENCE;
  const closed = new Set([...(settings.completedStatuses || DEFAULT_COMPLETED).split(","), ...NOT_OPEN].map((s) => s.trim().toLowerCase()));
  const tasks = Object.entries(activity.tasks || {})
    .map(([id, t]) => ({ id, ...t }))
    .filter((t) => matchesAudience(t, rule));

  const open = tasks.filter((t) => !closed.has(String(t.status).toLowerCase())).map((t) => ({ ...t, ...dueInfo(t.due, today) }));
  const created = tasks.filter((t) => t.createdAt && Date.parse(t.createdAt) >= weekAgo).length;
  const finished = tasks.filter((t) => t.finishedAt && Date.parse(t.finishedAt) >= weekAgo).length;
  if (!open.length && !created && !finished) return null;

  const people = groupByPerson(open);
  const overdue = open.filter((t) => t.overdue).length;
  const dueSoon = open.filter((t) => t.dueSoon).length;
  const digest = {
    header: `Week of ${formatDay(mondayOf(today), false)} — ${connection.name}`,
    subtitle: [`${open.length} open`, overdue && `${overdue} overdue`, dueSoon && `${dueSoon} due this week`].filter(Boolean).join(" · "),
    people: people.map((p) => ({
      heading: `${p.name} — ${p.tasks.length} open${p.overdue ? ` (${p.overdue} overdue)` : ""}`,
      lines: p.tasks.slice(0, TASKS_PER_PERSON).map((t) => ({ title: titleOf(t), link: taskUrl(t.id, settings.taskUrl), note: t.note })),
      more: Math.max(0, p.tasks.length - TASKS_PER_PERSON),
    })),
    pulse: [`Last week: ${created} new · ${finished} finished${finished ? " 🎉" : ""}`, open.length && !overdue ? "Nothing overdue 👏" : ""]
      .filter(Boolean)
      .join("<br>"),
  };

  // @mention only the people with something overdue, and only those whose chat id is on file.
  const mentions = people
    .filter((p) => p.overdue && p.person)
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
  sections.push({
    widgets: [
      { textParagraph: { text: d.pulse.split("<br>").map(escapeHtml).join("<br>") } },
      { buttonList: { buttons: [{ text: "Open zInspector", onClick: { openLink: { url: DASHBOARD } } }] } },
    ],
  });
  return { cardId: "digest", card: { header: { title: d.header, subtitle: d.subtitle }, sections } };
}

function digestText(d) {
  const people = d.people.flatMap((p) => [
    `*${p.heading}*`,
    ...p.lines.map((l) => `• ${l.link ? `<${l.link}|${l.title}>` : l.title}${l.note ? ` · ${l.note}` : ""}`),
    ...(p.more ? [`and ${p.more} more`] : []),
  ]);
  return [`*${d.header}*`, d.subtitle, "", ...people, "", ...d.pulse.split("<br>"), `<${DASHBOARD}|Open zInspector>`].join("\n");
}

function lineHtml(l) {
  const title = l.link ? `<a href="${escapeHtml(l.link)}">${escapeHtml(l.title)}</a>` : escapeHtml(l.title);
  return `• ${title}${l.note ? ` · ${escapeHtml(l.note)}` : ""}`;
}

// People with the most overdue, then the most open tasks, first; each person's tasks overdue first, then
// by due date, then undated.
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { dueDate: "", overdue: false, dueSoon: false, note: "" };
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  if (days < 0) return { dueDate, overdue: true, dueSoon: false, note: `overdue since ${formatDay(dueDate, days >= -6)}` };
  if (days === 0) return { dueDate, overdue: false, dueSoon: true, note: "due today" };
  if (days <= 6) return { dueDate, overdue: false, dueSoon: true, note: `due ${formatDay(dueDate, true)}` };
  return { dueDate, overdue: false, dueSoon: false, note: `due ${formatDay(dueDate, false)}` };
}

// "Fri" when it's within the week, else "Oct 26".
function formatDay(ymd, weekdayOnly) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return weekdayOnly ? WEEKDAYS[d.getUTCDay()] : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
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
