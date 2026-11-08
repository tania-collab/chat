// The summary: one message per chat on the days and hour it chooses, listing the open tasks by urgency. Each chat picks what it lists (summaryOf). The tasks come
// from zInspector (summary.js reads them) or, without an API key, from the tasks the app has seen.

import { DEFAULT_COMPLETED, mentionFor, taskUrl } from "./messages.js";
import { TIME_ZONE, localDate } from "./time.js";
import { shortArea, priorityOf } from "./taskview.js";
// zInspector's list of open tasks: where "See them" and "Open the task list" go. (Its filters aren't in the address,
// so a link can't open just one property's tasks.)
const DASHBOARD = "https://dashboard.zinspector.com/task-list?active=true&mytasks=false";
// A property's page, which lists its tasks.
const PROPERTY_PAGE = "https://dashboard.zinspector.com/property/view/";
// Past due and coming up are listed in full; the other sections show a few and count the rest.
const SHORT_LIST = 5;
// "No due date" lists only tasks this new: they're the ones to date now.
const NEW_TASK_DAYS = 7;
// Plain headings (the text layout's): the tasks under them carry the message.
const SECTIONS = {
  // Often the work is done and only the task is still open.
  overdue: () => "*Past due* · already done? Close it in zInspector so it drops off.",
  coming: (s) => `*Coming up* (next ${s.days === 1 ? "day" : `${s.days} days`})`,
  undated: () => `*No due date* (new in the last ${NEW_TASK_DAYS} days)`,
  quiet: (s) => `*No activity for ${s.quietDays}+ days*`,
};
const KIND_OF = new Map(Object.entries(SECTIONS).map(([kind, heading]) => [heading, kind]));
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
// Tasks quiet for longer than this (days, 0 = no limit) are counted in one line, not listed: a weekly nudge
// helps with what just went quiet, not with what was dropped long ago.
export const QUIET_UP_TO = [30, 90, 180, 0];
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
  quietUpTo: 90,
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
  // An opening line saved while it was a suggested one follows today's suggestions.
  const intro = OLD_INTROS.includes(saved.intro) ? "" : saved.intro;
  return { ...SUMMARY_DEFAULTS, ...saved, postDays, owners, intro: intro || "" };
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
    .map((t) => ({ ...t, ...dueInfo(t.due, today, t.dueAt || (String(t.due || "").length > 10 ? t.due : null)) }));
}

// Followed tasks with no activity for the chat's quietDays or more, oldest first: the closest thing to a missed
// deadline on tasks without one. `listed` (ids already in the due list) are left out.
export function selectQuiet(tasks, summary, settings = {}, now = new Date(), listed = new Set()) {
  if (!summary.quietDays) return [];
  return followed(tasks, summary, settings, now)
    .filter((t) => !listed.has(t.id) && t.lastActivity)
    .map((t) => ({ ...t, quietDays: Math.floor((now.getTime() - Date.parse(t.lastActivity)) / DAY_MS) }))
    .filter((t) => t.quietDays >= summary.quietDays)
    .map((t) => ({ ...t, quiet: true, longQuiet: Boolean(summary.quietUpTo) && t.quietDays > summary.quietUpTo }));
}

// The summary as one chat message (text, so people can be @mentioned: chat cards can't), or null when there's
// nothing to list. `tasks` are task snapshots with their id; `pulse` adds last week's new / finished counts
// (weekly, seen tasks).
export function buildDigest(connection, tasks, settings = {}, now = new Date(), { pulse = false, preview = false, format = null } = {}) {
  const summary = summaryOf(connection);
  const today = localDate(now);
  const due = selectTasks(tasks, summary, settings, now);
  const allQuiet = selectQuiet(tasks, summary, settings, now, new Set(due.map((t) => t.id)));
  const quiet = allQuiet.filter((t) => !t.longQuiet);
  const longQuiet = allQuiet.length - quiet.length;
  const open = [...due, ...allQuiet];
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
  // The suggested opening line greets by time of day, and Mondays with the week ahead.
  const weekly = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()] === "Mon";
  const openers = weekly ? DEFAULT_INTRO.weekly : summary.hour >= 12 ? DEFAULT_INTRO.afternoon : DEFAULT_INTRO.daily;
  const intro = fill(summary.intro || rotate(openers, today), values);
  const counts = [
    overdue && `${overdue} past due`,
    coming && `${coming} coming up`,
    undated && `${undated} without a date`,
    quiet.length && `${quiet.length} quiet`,
  ].filter(Boolean);

  // One list of tasks, by urgency; each task tags the people on it.
  const line = (t) => taskLine(t, taskUrl(t.id, settings.taskUrl), tag);
  const byDue = (x, y) => String(x.dueDate).localeCompare(String(y.dueDate));
  const isNew = (t) => t.createdAt && now.getTime() - Date.parse(t.createdAt) <= NEW_TASK_DAYS * DAY_MS;
  const noDate = due.filter((t) => !t.dueDate);
  const olderUndated = noDate.filter((t) => !isNew(t)).length;
  // "Plus 28 more quiet tasks: BizDev / Company (20), BizDev / Strategic (8)", each opening that property's tasks.
  const more = (n, what, hiddenTasks) => {
    const where = whereLinks(hiddenTasks);
    return `Plus ${n} ${what}${where ? `: ${where}` : `. <${DASHBOARD}|See them in zInspector>`}`;
  };
  // [heading, tasks, how many to show (all when null), the line for the rest]
  const groups = [
    [SECTIONS.overdue, due.filter((t) => t.overdue).sort(byDue), null],
    [SECTIONS.coming, due.filter((t) => t.dueDate && !t.overdue).sort(byDue), null],
    [SECTIONS.undated, noDate.filter(isNew), SHORT_LIST, (n) => `more new ${n === 1 ? "task" : "tasks"} with no due date`],
    // Most recently quiet first: those can still be saved.
    [SECTIONS.quiet, quiet.sort((x, y) => x.quietDays - y.quietDays), SHORT_LIST, (n) => `more quiet ${n === 1 ? "task" : "tasks"}`],
  ];
  const parts = groups
    .map(([heading, tasks, max, rest]) => [heading, mergeSame(tasks), max, rest])
    .filter(([, list]) => list.length)
    .map(([heading, list, max, rest]) => {
      const shown = max == null ? list : list.slice(0, max);
      const rest_ = list.slice(shown.length);
      const hidden = rest_.reduce((n, t) => n + (t.copies || 1), 0);
      const total = list.reduce((n, t) => n + (t.copies || 1), 0);
      return { kind: KIND_OF.get(heading), heading: heading(summary), shown, total, more: hidden ? more(hidden, rest(hidden), rest_) : "" };
    });
  const extras = [];
  if (olderUndated && summary.onlyDated === false) {
    extras.push(more(olderUndated, `older ${olderUndated === 1 ? "task" : "tasks"} with no due date`, noDate.filter((t) => !isNew(t))));
  }
  if (longQuiet) {
    extras.push(
      `Plus ${longQuiet === 1 ? "1 older task" : `${longQuiet} older tasks`} with no activity for over ${cutoffLabel(summary.quietUpTo)}. Worth a clean-up? ${whereLinks(allQuiet.filter((t) => t.longQuiet)) || `<${DASHBOARD}|Review in zInspector>`}`,
    );
  }
  const notes = [
    pulse ? `Last week the team opened ${created} and wrapped up ${finished}${finished ? " 🎉" : ""}` : "",
    due.length && !overdue && summary.includeOverdue ? "Nothing past due 👍" : "",
    rotate(weekly ? CLOSERS.weekly : CLOSERS.daily, today),
  ].filter(Boolean);

  // Google Chat: the greeting with a card per section, then one reply in its thread tagging the people with the
  // next step on past-due and coming-up tasks (cards can't @mention), a line per section saying what to do. Each
  // person is @mentioned once, on their first line; later lines name them without a second ping.
  if (connection.platform === "google-chat" && format !== "text") {
    const areas = new Set(parts.flatMap((p) => p.shown).map((t) => t.propertyName || ""));
    const messages = [{ text: intro, cardsV2: digestCards({ parts, extras, notes, summary, showArea: areas.size > 1 }, settings) }];
    const tagged = new Set();
    const lines = parts
      .filter((p) => TAG_HINT[p.kind])
      .map((p) => {
        const people = [...new Map(p.shown.map(nextStepPerson).filter(Boolean).map((x) => [x.name, x])).values()];
        if (!people.length) return "";
        const names = people.map((x) => (tagged.has(x.name) ? `*${x.name}*` : (tagged.add(x.name), tag(x))));
        return `👆 ${CARD_EMOJI[p.kind]} ${SECTION_NAME[p.kind]}: ${names.join(" · ")}: ${TAG_HINT[p.kind]}`;
      })
      .filter(Boolean);
    if (lines.length) messages.push({ text: lines.join("\n") });
    return { messages, threadKey: `summary-${connection.id || "chat"}-${today}` };
  }

  const sections = parts.map((p) => [p.heading, ...p.shown.map(line), p.more].filter(Boolean).join("\n")).concat(extras);
  const footer = [...notes, `<${DASHBOARD}|Open the task list in zInspector →>`];
  const text = [intro, counts.length ? `_${counts.join(" · ")}_` : "", ...sections, footer.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  return { text };
}

// The people a listed task tags: its owner, and the next to-do person when that's someone else.
function peopleToTag(t) {
  const next = realPerson(t.nextPerson || (t.next ? { name: t.next } : null));
  return [t.owner?.person, next].filter((p, i, all) => p?.name && all.findIndex((q) => q?.name === p.name) === i);
}

// Whoever has a task's next step: the next to-do person, else its owner.
function nextStepPerson(t) {
  return realPerson(t.nextPerson || (t.next ? { name: t.next } : null)) || t.owner?.person || null;
}

const CARD_EMOJI = { overdue: "🔴", coming: "🗓️" };
const SECTION_NAME = { overdue: "Past due", coming: "Coming up" };

// What the tag line under a card asks of the people on those tasks.
const TAG_HINT = {
  overdue: "already done? Close it in zInspector so it drops off. Still on it? Set a new date.",
  coming: "still on track? If plans changed, update the due date.",
};

const COLOR = { overdue: "#d93025", highest: "#d93025", high: "#e8710a", soon: "#e37400", later: "#5f6368", quiet: "#5f6368", none: "#5f6368" };
const CARD_HEAD = {
  overdue: (p) => ({ title: `🔴 Past due · ${p.total}`, subtitle: "Due date passed, task still open" }),
  coming: (p, s) => ({ title: `🗓️ Coming up · ${p.total}`, subtitle: `Due in the next ${s.days === 1 ? "day" : `${s.days} days`}` }),
  undated: (p) => ({ title: `📅 No due date · ${p.total} new`, subtitle: "Created this week. When should they be done?" }),
  quiet: (p, s) => ({ title: `💤 Quiet · ${p.total}`, subtitle: `No activity for ${s.quietDays}+ days. Still on your radar?` }),
};

// A card per section, its header the section's name and count. Each task takes two lines: the title with an Open
// button, then when (in color), priority when it's high, who, and the next step. Quiet and no-date start
// collapsed. A last card holds the "plus N more" lines, the closing line and a button.
function digestCards({ parts, extras, notes, summary, showArea }, settings) {
  const cards = parts.map((p) => {
    const widgets = p.shown.flatMap((t, i) => [...(i ? [{ divider: {} }] : []), taskRow(t, taskUrl(t.id, settings.taskUrl), showArea)]);
    if (p.more) widgets.push({ textParagraph: { text: chatToHtml(p.more) } });
    const section = { widgets };
    if (p.kind === "quiet" || p.kind === "undated") Object.assign(section, { collapsible: true, uncollapsibleWidgetsCount: 1 });
    return { cardId: p.kind, card: { header: CARD_HEAD[p.kind](p, summary), sections: [section] } };
  });
  cards.push({
    cardId: "more",
    card: {
      sections: [
        {
          widgets: [
            ...[...extras.map(chatToHtml), ...notes.map(escapeHtml)].map((text) => ({ textParagraph: { text } })),
            { buttonList: { buttons: [{ text: "Open the task list", onClick: { openLink: { url: DASHBOARD } } }] } },
          ],
        },
      ],
    },
  });
  return cards;
}

function taskRow(t, link, showArea) {
  const title = titleOf(t, 140).replace(/\s*\|\s*/g, " – ");
  const tone = t.quiet ? "quiet" : t.overdue ? "overdue" : t.daysLeft != null && t.daysLeft <= 1 ? "soon" : t.dueDate ? "later" : "none";
  const when = t.quiet ? `quiet ${quietFor(t.quietDays)}` : t.note || "no due date";
  const priority = priorityOf(t.priority);
  const details = [
    `<font color="${COLOR[tone]}">${escapeHtml(when)}</font>`,
    priority.tone === "high" || priority.tone === "highest" ? `<font color="${COLOR[priority.tone]}">${escapeHtml(priority.label)}</font>` : "",
    escapeHtml(peopleOn(t, (p) => p.name)),
    t.todo?.next ? `Next: ${escapeHtml(t.todo.next)} (${t.todo.done} of ${t.todo.total})` : "",
  ].filter(Boolean);
  const row = { text: `<b>${escapeHtml(title)}</b>${t.copies > 1 ? ` (${t.copies} tasks)` : ""}<br>${details.join(" · ")}`, wrapText: true };
  const area = showArea ? shortArea(t.propertyName) : "";
  if (area) row.topLabel = area;
  if (link) row.button = { text: "Open", onClick: { openLink: { url: link } } };
  return { decoratedText: row };
}

// "Plus 3 more. <https://…|See them>" (chat markup) as card HTML.
function chatToHtml(s) {
  return String(s)
    .split(/(<https?:\/\/[^|>]+\|[^>]+>)/)
    .map((part) => {
      const m = part.match(/^<(https?:\/\/[^|>]+)\|([^>]+)>$/);
      return m ? `<a href="${escapeHtml(m[1])}">${escapeHtml(m[2])}</a>` : escapeHtml(part);
    })
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The summary's opening lines, one a day in turn; [Chat name], [Day], [Week], [Days], [Due count] and
// [Overdue count] are filled in. A chat can set its own instead.
export const DEFAULT_INTRO = {
  daily: ["*Good morning, [Chat name].* Here's where things stand."],
  afternoon: ["*Hi [Chat name],* here's where things stand."],
  weekly: ["*Happy Monday, [Chat name].* Here's the week ahead."],
};
// The closing line: an open door to reply, said once.
export const CLOSERS = {
  daily: ["Anything stuck, or already done? Reply in this thread."],
  weekly: ["Anything stuck, or already done? Reply in this thread."],
};

// Suggested opening lines from earlier versions.
const OLD_INTROS = [
  "☀️ *Good morning, [Chat name]!* Here's what's on deck today, plus a few things that could use a little love 👇",
  "☕ *Morning, [Chat name]!* Curious what today holds? Here's where things stand 👇",
  "👋 *Hey [Chat name]!* Fresh day, fresh momentum. Here's your lineup 👇",
  "🌤️ *Afternoon, [Chat name]!* Here's a quick look at where things stand 👇",
  "👋 *Hey [Chat name]!* Quick check-in before the day wraps up 👇",
  "👋 *Happy Monday, [Chat name]!* New week, clean slate. Here's what's coming up 👇",
  "🌱 *Hello [Chat name], and happy Monday!* Here's the week of [Week] at a glance 👇",
  "☀️ *Good morning, [Chat name]!* Here's what's coming up ([Day])",
  "👋 *Happy Monday, [Chat name]!* Here's the week of [Week]",
];

// The next time a chat's summary goes out (the next :30 of its hour on one of its days), or null when off.
export function nextSendTime(summary, now = new Date()) {
  if (!summary.postDays.length) return null;
  const start = new Date(now);
  start.setUTCMinutes(30, 0, 0);
  if (start < now) start.setUTCHours(start.getUTCHours() + 1);
  for (let h = 0; h < 24 * 8; h++) {
    const at = new Date(start.getTime() + h * 3600 * 1000);
    if (isSummaryTime(summary, at)) return at;
  }
  return null;
}

// "Mon, Nov 9 at 8:30am".
export function sendTimeLabel(at, summary) {
  return `${longDay(localDate(at))} at ${hourLabel(summary.hour)}`;
}

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
  const next = realPerson(t.nextPerson || (t.next ? { name: t.next } : null));
  if (realPerson(t.assignee)) return { person: t.assignee, role: "assigned" };
  if (owners !== "assigned" && next) return { person: next, role: "next" };
  if (owners === "anyone" && realPerson(t.manager)) return { person: t.manager, role: "manager" };
  return null;
}

// zInspector's system accounts ("Ticket Notify", "Z Support") file emails as tasks; they aren't people to tag.
const SYSTEM_ACCOUNT = /\b(notify|notifications?|support|no-?reply|system|bot)\b/i;
function realPerson(p) {
  return p?.name && !SYSTEM_ACCOUNT.test(p.name) ? p : null;
}

// "🔴 <link|Title> — 3 days past due · @Tim, with @Laura up next · In Progress": a dot for how soon, the title
// linked, when, the people on the task (assignee, next to-do, or the manager when it's theirs), and the status
// once past New.
// Where some tasks are, as links to their properties' pages (which list each property's tasks):
// "BizDev / Company (20), BizDev / Strategic (8)"; "" when none has a known property (the caller links the task list).
function whereLinks(tasks) {
  const byProperty = new Map();
  for (const t of tasks) {
    const key = t.propertyId ?? "";
    const p = byProperty.get(key) || { id: t.propertyId, name: shortArea(t.propertyName) || t.propertyName || "", count: 0 };
    p.count += t.copies || 1;
    byProperty.set(key, p);
  }
  const known = [...byProperty.values()].filter((p) => p.id != null).sort((a, b) => b.count - a.count);
  if (!known.length) return "";
  const links = known.map((p) => `<${PROPERTY_PAGE}${encodeURIComponent(p.id)}|${(p.name || "Property").replace(/[<>|]/g, " ")} (${p.count})>`);
  const unknown = byProperty.get("")?.count;
  return `${links.join(", ")}${unknown ? `, and <${DASHBOARD}|${unknown} more>` : ""}`;
}

// The same task filed twice (an email that arrived twice, say) shows once: "Title (2 tasks)".
function mergeSame(tasks) {
  const byTitle = new Map();
  for (const t of tasks) {
    const key = `${titleOf(t).toLowerCase()}|${t.propertyId ?? t.propertyName ?? ""}`;
    const first = byTitle.get(key);
    if (first) first.copies = (first.copies || 1) + 1;
    else byTitle.set(key, { ...t });
  }
  return [...byTitle.values()];
}

function taskLine(t, link, tag) {
  const title = titleOf(t).replace(/\s*\|\s*/g, " – ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  const dot = t.quiet ? "💤" : t.overdue ? "🔴" : t.daysLeft != null && t.daysLeft <= 1 ? "🟠" : t.dueDate ? "🔹" : "▫️";
  const when = t.quiet ? `quiet ${quietFor(t.quietDays)}` : t.note;
  const status = t.status && !/^new$/i.test(t.status) ? t.status : "";
  const copies = t.copies > 1 ? ` (${t.copies} tasks)` : "";
  const head = [`${dot} ${link ? `<${link}|${title}>` : `*${title}*`}${copies}`, [when, peopleOn(t, tag), status].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join(" — ");
  // The pending step, when zInspector shared the task's to-dos: more useful than the date alone.
  const todo = t.todo?.next ? `\n      ➡️ Next: ${t.todo.next.replace(/[<>|]/g, " ")} _(${t.todo.done} of ${t.todo.total} done)_` : "";
  return head + todo;
}

// Who to tag on a task line: "@Tim", "@Tim (next: @Laura)", "@Laura (next to-do)", "@Athina (manager)".
function peopleOn(t, tag) {
  const next = realPerson(t.nextPerson || (t.next ? { name: t.next } : null));
  if (t.owner?.role === "assigned") return next && next.name !== t.assignee.name ? `${tag(t.assignee)} (next: ${tag(next)})` : tag(t.assignee);
  if (t.owner?.role === "next") return `${tag(t.owner.person)} (next to-do)`;
  if (t.owner?.role === "manager") return `${tag(t.owner.person)} (manager)`;
  return "";
}

// "a month", "3 months": the quiet cut-off in words.
function cutoffLabel(days) {
  return days <= 31 ? "a month" : `${Math.round(days / 30)} months`;
}

// "9 days", "3 weeks", "4 months".
function quietFor(days) {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

function dueInfo(due, today, at = null) {
  // A due time (ISO, UTC) gives the day in Pacific time, and the hour for today and tomorrow.
  const local = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  const dueDate = local ? localDate(local) : String(due || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { dueDate: "", overdue: false, daysLeft: null, note: "" };
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  const base = { dueDate, overdue: days < 0, daysLeft: days };
  if (days < 0) return { ...base, note: days === -1 ? "1 day overdue" : `${-days} days overdue` };
  const time = local ? ` at ${timeLabel(local)}` : "";
  if (days === 0) return { ...base, note: `due today${time}` };
  if (days === 1) return { ...base, note: `due tomorrow${time}` };
  return { ...base, note: `due ${formatDay(dueDate, days <= 6)}` };
}

// "7:00am", "12:30pm", Pacific time.
function timeLabel(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true })
    .format(date)
    .replace(" ", "")
    .toLowerCase();
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

function titleOf(t, max = 70) {
  const first = String(t.description || "").split("\n")[0].trim();
  return (first.length > max ? first.slice(0, max - 1) + "…" : first) || t.type || "Task";
}

