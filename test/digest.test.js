import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, isSummaryTime, describeSchedule, nextSendTime, sendTimeLabel, selectTasks, summaryOf, SUMMARY_DEFAULTS, DEFAULT_INTRO, CLOSERS } from "../src/digest.js";
import worker from "../src/worker.js";
import { makeEnv, admin, hook, withChat, created, withStatus, GCHAT_URL, ORIGIN } from "./helpers.js";

// A posted Google Chat summary: the tagging line, and the card's text (section headers and rows) one per line.
const cardLines = (body) =>
  (body.cardsV2 || []).flatMap(({ card }) => [
    ...(card.header ? [`## ${card.header.title}`] : []),
    ...card.sections.flatMap((s) =>
      s.widgets.map((w) => (w.decoratedText ? [w.decoratedText.topLabel, w.decoratedText.text].filter(Boolean).join(" | ") : w.textParagraph?.text || "")),
    ),
  ]);

// The summary's text layout (Slack's, and what the Google Chat card shows), whatever the chat app.
const buildText = (c, tasks, settings, now, options = {}) => buildDigest(c, tasks, settings, now, { ...options, format: "text" });
const MONDAY = new Date("2026-10-26T15:30:00Z"); // 8:30am in Los Angeles (daylight saving)
const weekly = { name: "Marketing tasks", platform: "google-chat", summary: { schedule: "weekly" } };
const daily = { ...weekly, summary: { schedule: "daily" } };
const tim = { name: "Tim Wallace", email: "tim+onsight@zinspector.com" };
const laura = { name: "Laura E.", email: "laura@zinspector.com" };
let nextId = 1;
const task = (over) => ({ id: String(nextId++), status: "New", assignee: tim, description: "A task", due: null, next: "", ...over });
const all = { ...SUMMARY_DEFAULTS, onlyDated: false, onlyAssigned: false, days: 30 };

test("a summary goes out on the chat's days at its hour and 30 minutes, Pacific time all year", () => {
  const at = (postDays, hour, iso) => isSummaryTime({ postDays, hour }, new Date(iso));
  assert.equal(at(["Mon"], 8, "2026-10-26T15:30:00Z"), true); // Monday 8:30 PDT
  assert.equal(at(["Mon"], 8, "2026-10-26T16:30:00Z"), false); // 9:30
  assert.equal(at(["Mon"], 8, "2026-12-07T16:30:00Z"), true); // Monday 8:30 PST
  assert.equal(at(["Mon"], 8, "2026-12-08T16:30:00Z"), false); // Tuesday
  assert.equal(at(["Mon", "Wed", "Fri"], 14, "2026-12-09T22:30:00Z"), true); // Wednesday 2:30pm
  assert.equal(at(["Sat"], 8, "2026-12-12T16:30:00Z"), true);
  assert.equal(at([], 8, "2026-12-07T16:30:00Z"), false); // off
  assert.equal(describeSchedule({ postDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], hour: 8 }), "Weekdays at 8:30am");
  assert.equal(describeSchedule({ postDays: ["Mon"], hour: 8 }), "Mondays at 8:30am");
  assert.equal(describeSchedule({ postDays: ["Mon", "Wed", "Fri"], hour: 14 }), "Mon, Wed, Fri at 2:30pm");
  assert.equal(describeSchedule({ postDays: [], hour: 8 }), "Off");
});

test("chats from before keep their schedule: weekly digest, daily or weekly summary, or off", () => {
  assert.deepEqual(summaryOf({}).postDays, ["Mon"]);
  assert.deepEqual(summaryOf({ alerts: { digest: false } }).postDays, []);
  assert.deepEqual(summaryOf({ summary: { schedule: "daily" } }).postDays, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  assert.deepEqual(summaryOf({ summary: { schedule: "weekly" } }).postDays, ["Mon"]);
  assert.deepEqual(summaryOf({ alerts: { digest: false }, summary: { schedule: "daily" } }).postDays.length, 5);
  assert.equal(summaryOf({}).hour, 8);
});

test("lists open tasks due within the window plus overdue ones, filtered as the chat chose", () => {
  const tasks = [
    task({ description: "overdue", due: "2026-10-20", propertyName: "Marketing.Conferences" }),
    task({ description: "this week", due: "2026-10-30", propertyName: "Marketing.BizDev.Strategic" }),
    task({ description: "later", due: "2026-11-20", propertyName: "Marketing.Conferences" }),
    task({ description: "no date", propertyName: "Marketing.Conferences" }),
    task({ description: "nobody", due: "2026-10-27", assignee: null, propertyName: "Marketing.Conferences" }),
    task({ description: "other property", due: "2026-10-27", propertyName: "Z.0001.Some Client" }),
    task({ description: "done", due: "2026-10-27", status: "Work Complete", propertyName: "Marketing.Conferences" }),
  ];
  const pick = (over) => selectTasks(tasks, { ...SUMMARY_DEFAULTS, ...over }, {}, MONDAY).map((t) => t.description);

  assert.deepEqual(pick({}), ["overdue", "this week", "other property"]);
  assert.deepEqual(pick({ includeOverdue: false }), ["this week", "other property"]);
  assert.deepEqual(pick({ onlyDated: false }), ["overdue", "this week", "no date", "other property"]);
  assert.deepEqual(pick({ owners: "assigned" }), ["overdue", "this week", "other property"]);
  assert.deepEqual(pick({ days: 30 }), ["overdue", "this week", "later", "other property"]);
  assert.deepEqual(
    pick({ onlyProperties: true, properties: [{ label: "x", name: "Marketing.Conferences", ids: [] }, { label: "y", name: "Marketing.BizDev*", ids: [] }] }),
    ["overdue", "this week"],
  );
  assert.deepEqual(pick({ onlyProperties: true, properties: [{ label: "1", name: "", ids: [42] }] }), []);
});

test("overdue tasks are listed only as far back as the chat chose, so long-forgotten ones stay out", () => {
  const tasks = [
    task({ description: "last week", due: "2026-10-20" }),
    task({ description: "two months ago", due: "2026-08-20" }),
    task({ description: "last spring", due: "2026-03-04" }),
  ];
  const pick = (overdueWithin) => selectTasks(tasks, { ...SUMMARY_DEFAULTS, overdueWithin }, {}, MONDAY).map((t) => t.description);
  assert.deepEqual(pick(7), ["last week"]);
  assert.deepEqual(pick(30), ["last week"]);
  assert.deepEqual(pick(90), ["last week", "two months ago"]);
  assert.deepEqual(pick(0), ["last week", "two months ago", "last spring"]);
  assert.equal(SUMMARY_DEFAULTS.overdueWithin, 30);
});

test("tasks nobody is assigned to go under the next to-do, or the manager, as the chat chose, saying why", () => {
  const nobody = { assignee: null, due: "2026-10-27" };
  const tasks = [
    task({ ...nobody, description: "next", nextPerson: laura }),
    task({ ...nobody, description: "managed", manager: { name: "Athina G.", email: "athina@zinspector.com" } }),
    task({ description: "assigned", due: "2026-10-27", nextPerson: laura, manager: laura }),
  ];
  const pick = (owners) => selectTasks(tasks, { ...SUMMARY_DEFAULTS, owners }, {}, MONDAY).map((t) => `${t.description}:${t.owner.person.name}`);
  assert.deepEqual(pick("assigned"), ["assigned:Tim Wallace"]);
  assert.deepEqual(pick("assigned-or-next"), ["next:Laura E.", "assigned:Tim Wallace"]);
  assert.deepEqual(pick("anyone"), ["next:Laura E.", "managed:Athina G.", "assigned:Tim Wallace"]);
  assert.equal(SUMMARY_DEFAULTS.owners, "assigned-or-next");

  const { text } = buildText({ ...weekly, summary: { schedule: "weekly", owners: "anyone" } }, tasks, {}, MONDAY);
  assert.match(text, /^🟠 \*next\* — due tomorrow · \*Laura E\.\* \(next to-do\)$/m);
  assert.match(text, /^🟠 \*managed\* — due tomorrow · \*Athina G\.\* \(manager\)$/m);
  assert.match(text, /^🟠 \*assigned\* — due tomorrow · \*Tim Wallace\* \(next: \*Laura E\.\*\)$/m);
});

test("chats saved with the old assigned checkbox keep their choice", () => {
  assert.equal(summaryOf({ summary: { onlyAssigned: true } }).owners, "assigned");
  assert.equal(summaryOf({ summary: { onlyAssigned: false } }).owners, "anyone");
  assert.equal(summaryOf({}).owners, "assigned-or-next");
});

test("going quiet lists recently quiet tasks first, and only counts the ones dropped long ago", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const tasks = [
    task({ id: "q1", description: "Keyrenter follow up", lastActivity: ago(122) }),
    task({ id: "q2", description: "WaterGuru", lastActivity: ago(20), status: "In Progress" }),
    task({ id: "q3", description: "Fresh", lastActivity: ago(3) }),
    task({ id: "q4", description: "Due soon and quiet", due: "2026-10-27", lastActivity: ago(40) }),
    task({ id: "q5", description: "Quiet but closed", status: "Closed", lastActivity: ago(90) }),
    task({ id: "q6", description: "Slipping", lastActivity: ago(45) }),
    task({ id: "q7", description: "Ancient", lastActivity: ago(640) }),
  ];
  const { text } = buildText(weekly, tasks, {}, MONDAY);
  assert.match(text, /^_1 coming up · 2 quiet_$/m);
  assert.match(
    text,
    /^\*No activity for 14\+ days\*\n💤 \*WaterGuru\* — quiet 2 weeks · \*Tim Wallace\* · In Progress\n💤 \*Slipping\* — quiet 6 weeks · \*Tim Wallace\*$/m,
  );
  assert.match(text, /^Plus 2 older tasks with no activity for over 3 months\. Worth a clean-up\? <https:\/\/dashboard\.zinspector\.com\/task-list\?active=true&mytasks=false\|Review in zInspector>$/m);
  assert.match(text, /^🟠 \*Due soon and quiet\* — due tomorrow · \*Tim Wallace\*$/m);
  assert.doesNotMatch(text, /Keyrenter|Ancient|Fresh/);
  const noLimit = buildText({ ...weekly, summary: { schedule: "weekly", quietUpTo: 0 } }, tasks, {}, MONDAY).text;
  assert.match(noLimit, /Keyrenter follow up\* — quiet 4 months/);
  assert.doesNotMatch(noLimit, /older tasks/);
  assert.equal(buildText({ ...weekly, summary: { schedule: "weekly", quietDays: 0 } }, tasks.slice(0, 2), {}, MONDAY), null);
});

test("system accounts aren't tagged: a task waiting on Ticket Notify goes to the next real person", () => {
  const bot = { name: "Ticket Notify", email: "" };
  const tasks = [
    task({ id: "s1", description: "Assigned, bot next", due: "2026-10-27", nextPerson: bot }),
    task({ id: "s2", description: "Bot next, managed", assignee: null, due: "2026-10-27", nextPerson: bot, manager: laura }),
    task({ id: "s3", description: "Only bots", assignee: null, due: "2026-10-27", nextPerson: bot, manager: { name: "Z Support" } }),
  ];
  const { text } = buildText({ ...weekly, summary: { schedule: "weekly", owners: "anyone" } }, tasks, {}, MONDAY);
  assert.match(text, /\*Assigned, bot next\* — due tomorrow · \*Tim Wallace\*$/m);
  assert.match(text, /\*Bot next, managed\* — due tomorrow · \*Laura E\.\* \(manager\)$/m);
  assert.doesNotMatch(text, /Only bots|Ticket Notify|Z Support/);
});

test("a due time shows for today and tomorrow, in Pacific time, and sets the day", () => {
  const tasks = [
    task({ id: "t1", description: "Booth call", due: "2026-10-27", dueAt: "2026-10-27T14:00:00Z" }), // 7am PDT tomorrow
    task({ id: "t2", description: "Later", due: "2026-10-30", dueAt: "2026-10-30T19:00:00Z" }),
    // 5pm Pacific on Oct 26 is already Oct 27 in UTC: still "today".
    task({ id: "t3", description: "Evening", due: "2026-10-27", dueAt: "2026-10-27T00:00:00Z" }),
  ];
  const { text } = buildText(weekly, tasks, {}, MONDAY);
  assert.match(text, /\*Booth call\* — due tomorrow at 7:00am/);
  assert.match(text, /\*Later\* — due Fri ·/);
  assert.match(text, /\*Evening\* — due today at 5:00pm/);
});

test("past due and coming up list everything; no-date and quiet show 5 and count the rest", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const tasks = [
    ...Array.from({ length: 7 }, (_, i) => task({ id: `o${i}`, description: `Late ${i}`, due: "2026-10-20" })),
    ...Array.from({ length: 7 }, (_, i) => task({ id: `c${i}`, description: `Soon ${i}`, due: "2026-10-28" })),
    ...Array.from({ length: 7 }, (_, i) => task({ id: `q${i}`, description: `Quiet ${i}`, due: "2026-11-30", lastActivity: ago(15 + i) })),
  ];
  const { text } = buildText({ ...weekly, summary: { schedule: "weekly" } }, tasks, { taskUrl: "https://z/{id}" }, MONDAY);
  assert.equal((text.match(/Late \d/g) || []).length, 7);
  assert.equal((text.match(/Soon \d/g) || []).length, 7);
  assert.equal((text.match(/Quiet \d/g) || []).length, 5);
  assert.match(text, /^Plus 2 more quiet tasks\. <https:\/\/dashboard\.zinspector\.com\/task-list\?active=true&mytasks=false\|See them in zInspector>$/m);
});

test("no due date lists only tasks from the last 7 days, and counts the older ones", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const tasks = [
    task({ id: "n1", description: "Brand new", createdAt: ago(2) }),
    task({ id: "n2", description: "Old one", createdAt: ago(40) }),
    task({ id: "n3", description: "Unknown age" }),
  ];
  const { text } = buildText({ ...weekly, summary: { schedule: "weekly", onlyDated: false } }, tasks, {}, MONDAY);
  assert.match(text, /^\*No due date\* \(new in the last 7 days\)\n▫️ \*Brand new\* — \*Tim Wallace\*$/m);
  assert.match(text, /^Plus 2 older tasks with no due date\. </m);
  assert.doesNotMatch(text, /Old one|Unknown age/);
});

test("the same task filed twice shows once, saying how many", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const album = { description: "Your album from Storibox at SlotZilla Las Vegas", propertyName: "Marketing.Conferences", lastActivity: ago(16) };
  const tasks = [task({ id: "a1", ...album }), task({ id: "a2", ...album, assignee: laura }), task({ id: "b", description: "Other", lastActivity: ago(16) })];
  const { text } = buildText(weekly, tasks, {}, MONDAY);
  assert.equal((text.match(/Storibox/g) || []).length, 1);
  assert.match(text, /\*Your album from Storibox at SlotZilla Las Vegas\* \(2 tasks\) — quiet 2 weeks/);
});

test("in Google Chat: one message with the cards, then one reply tagging each person once with what to do", () => {
  const settings = { taskUrl: "https://z/{id}", people: [{ email: "tim@zinspector.com", googleChatId: "111" }, { email: "laura@zinspector.com", googleChatId: "222" }] };
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const tasks = [
    task({ id: "1", description: "Booth call", due: "2026-10-27", dueAt: "2026-10-27T14:00:00Z", priority: 5, propertyName: "Marketing.Conferences", nextPerson: laura, todo: { next: "Pick a booth", done: 1, total: 4 } }),
    task({ id: "2", description: "Late one", due: "2026-10-20", status: "In Progress", propertyName: "Marketing.Conferences" }),
    task({ id: "4", description: "Also soon", due: "2026-10-28", propertyName: "Marketing.Conferences" }),
    task({ id: "3", description: "Gone quiet", assignee: laura, propertyName: "Marketing.Conferences", lastActivity: ago(20) }),
  ];
  const { messages, threadKey } = buildDigest({ ...weekly, id: "c1" }, tasks, settings, MONDAY);
  assert.equal(threadKey, `summary-c1-${MONDAY.getTime()}`);
  // Sent again the same day, it starts its own thread.
  assert.notEqual(buildDigest({ ...weekly, id: "c1" }, tasks, settings, new Date(MONDAY.getTime() + 60000)).threadKey, threadKey);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, "*Happy Monday, Marketing tasks.* Here's the week ahead.");
  assert.deepEqual(messages[0].cardsV2.map((c) => c.card.header?.title), ["🔴 Past due · 1", "🗓️ Coming up · 2", "💤 Quiet · 1", undefined]);
  // Tim (past due, and coming up) is tagged once; Laura has the booth call's next step.
  assert.equal(
    messages[1].text,
    "👆 <users/111> · <users/222>: you have tasks above. Already done? Close it in zInspector so it drops off. Plans changed? Update the due date.",
  );
  assert.deepEqual(messages[0].cardsV2[1].card.sections[0].widgets[0].decoratedText, {
    text: '<b>Booth call</b><br><font color="#e37400">due tomorrow at 7:00am</font> · <font color="#d93025">Highest priority</font> · Tim Wallace (next: Laura E.) · Next: Pick a booth (1 of 4)',
    wrapText: true,
    button: { text: "Open", onClick: { openLink: { url: "https://z/1" } } },
  }); // one area: no area label; normal priority isn't shown
  assert.equal(messages[0].cardsV2[2].card.sections[0].collapsible, true);
  assert.equal(messages[0].cardsV2.at(-1).card.sections[0].widgets.at(-1).buttonList.buttons[0].text, "Open the task list");
});

test("with only quiet tasks, the greeting rides on the cards", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const { messages } = buildDigest(weekly, [task({ lastActivity: ago(20) })], {}, MONDAY);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /^\*Happy Monday/);
  assert.equal(messages[0].cardsV2[0].card.header.title, "💤 Quiet · 1");
});

test("the 'plus N more' lines link to the properties those tasks are on, with counts", () => {
  const ago = (days) => new Date(MONDAY.getTime() - days * 864e5).toISOString();
  const on = (propertyId, propertyName, i) => task({ id: `${propertyId}-${i}`, description: `Quiet ${propertyId} ${i}`, propertyId, propertyName, lastActivity: ago(15 + i) });
  const tasks = [
    ...Array.from({ length: 4 }, (_, i) => on(952923, "Marketing.BizDev.Company", i)),
    ...Array.from({ length: 4 }, (_, i) => on(2206214, "Marketing.BizDev.Strategic", i + 4)),
    task({ id: "old", description: "Ancient", propertyId: 903925, propertyName: "Marketing.Conferences", lastActivity: ago(400) }),
  ];
  const { text } = buildText(weekly, tasks, {}, MONDAY);
  assert.match(
    text,
    /^Plus 3 more quiet tasks: <https:\/\/dashboard\.zinspector\.com\/property\/view\/2206214\|BizDev \/ Strategic \(3\)>$/m,
  );
  assert.match(text, /^Plus 1 older task with no activity for over 3 months\. Worth a clean-up\? <https:\/\/dashboard\.zinspector\.com\/property\/view\/903925\|Conferences \(1\)>$/m);
  const card = JSON.stringify(buildDigest(weekly, tasks, {}, MONDAY).messages);
  assert.match(card, /<a href=\\"https:\/\/dashboard\.zinspector\.com\/property\/view\/2206214\\">BizDev \/ Strategic \(3\)<\/a>/);
});

test("a task's pending to-do shows under it", () => {
  const t = task({ due: "2026-10-27", todo: { next: "Get attendee list", done: 5, total: 6 } });
  assert.match(buildText(weekly, [t], {}, MONDAY).text, /— due tomorrow · \*Tim Wallace\*\n      ➡️ Next: Get attendee list _\(5 of 6 done\)_$/m);
});

test("an opening line saved while it was the suggested one follows today's suggestions", () => {
  assert.equal(summaryOf({ summary: { intro: "👋 *Happy Monday, [Chat name]!* Here's the week of [Week]" } }).intro, "");
  assert.equal(summaryOf({ summary: { intro: "Hi [Chat name]" } }).intro, "Hi [Chat name]");
});

test("the preview is dated the next time the summary goes out", () => {
  const sunday = new Date("2026-11-08T20:00:00Z");
  const at = nextSendTime({ postDays: ["Mon"], hour: 8 }, sunday);
  assert.equal(at.toISOString(), "2026-11-09T16:30:00.000Z");
  assert.equal(sendTimeLabel(at, { hour: 8 }), "Mon, Nov 9 at 8:30am");
  assert.equal(nextSendTime({ postDays: [], hour: 8 }, sunday), null);
});

test("a property chosen by id matches tasks on it", () => {
  const tasks = [task({ due: "2026-10-27", propertyId: 42 }), task({ due: "2026-10-27", propertyId: 7 })];
  const summary = { ...SUMMARY_DEFAULTS, onlyProperties: true, properties: [{ label: "42", name: "", ids: [42] }] };
  assert.equal(selectTasks(tasks, summary, {}, MONDAY).length, 1);
});

test("the weekly summary: tasks by urgency, each tagging the people on it, with a question to reply to", () => {
  const tasks = [
    task({ id: "1", description: "webchatTEST", due: "2026-10-23", status: "In Progress", nextPerson: laura, createdAt: "2026-10-20T10:00:00Z" }),
    task({ id: "2", description: "Sponsor Sessions – PMSC 2027", due: "2026-10-28" }),
    task({ id: "3", description: "Email Campaigns", assignee: laura, due: "2026-10-27" }),
    task({ id: "4", description: "Done thing", status: "Work Complete", finishedAt: "2026-10-22T10:00:00Z" }),
  ];
  const settings = { taskUrl: "https://z/task/{id}", people: [{ email: "tim@zinspector.com", googleChatId: "111" }] };
  const { text } = buildText(weekly, tasks, settings, MONDAY, { pulse: true });
  const [intro, ...rest] = text.split("\n\n");
  assert.ok(DEFAULT_INTRO.weekly.map((l) => l.replace("[Chat name]", "Marketing tasks").replace("[Week]", "Oct 26")).includes(intro));
  assert.deepEqual(rest.slice(0, 3), [
    "_1 past due · 2 coming up_",
    "*Past due* · already done? Close it in zInspector so it drops off.\n" +
      "🔴 <https://z/task/1|webchatTEST> — 3 days overdue · <users/111> (next: *Laura E.*) · In Progress",
    "*Coming up* (next 7 days)\n" +
      "🟠 <https://z/task/3|Email Campaigns> — due tomorrow · *Laura E.*\n" +
      "🔹 <https://z/task/2|Sponsor Sessions – PMSC 2027> — due Wed · <users/111>",
  ]);
  const footer = rest[3].split("\n");
  assert.equal(footer[0], "Last week the team opened 1 and wrapped up 1 🎉");
  assert.ok(CLOSERS.weekly.includes(footer[1]));
  assert.equal(footer[2], "<https://dashboard.zinspector.com/task-list?active=true&mytasks=false|Open the task list in zInspector →>");
});

test("the opening line greets by time of day and Mondays; a chat's own opening line is used as written", () => {
  const one = [task({ due: "2026-10-30" })];
  const tuesday = new Date(MONDAY.getTime() + 864e5);
  assert.match(buildText(weekly, one, {}, MONDAY).text, /^\*Happy Monday, Marketing tasks\.\* Here's the week ahead\.\n/);
  assert.match(buildText(daily, one, {}, tuesday).text, /^\*Good morning, Marketing tasks\.\* Here's where things stand\.\n/);
  const afternoon = { ...daily, summary: { schedule: "daily", hour: 14 } };
  assert.match(buildText(afternoon, one, {}, tuesday).text, /^\*Hi Marketing tasks,\* here's where things stand\.\n/);
  assert.match(buildText(daily, one, {}, tuesday).text, /\nAnything stuck, or already done\? Reply in this thread\.\n/);
  const reworded = { ...daily, summary: { schedule: "daily", intro: "[Chat name]: [Due count] due, [Overdue count] late, [Unknown]" } };
  assert.match(buildText(reworded, one, {}, MONDAY).text, /^Marketing tasks: 1 due, 0 late, \[Unknown\]\n/);
  assert.equal(summaryOf({ summary: { intro: "☕ *Morning, [Chat name]!* Curious what today holds? Here's where things stand 👇" } }).intro, "");
});

test("people are @mentioned on their tasks when their chat id is on file, else named in bold; the preview shows names", () => {
  const settings = { people: [{ email: "tim@zinspector.com", googleChatId: "111" }] };
  const tasks = [task({ id: "a", description: "Mine", due: "2026-10-27" }), task({ id: "b", description: "Hers", assignee: laura, due: "2026-10-27" })];
  const { text } = buildText(weekly, tasks, settings, MONDAY);
  assert.match(text, /^🟠 \*Mine\* — due tomorrow · <users\/111>$/m);
  assert.match(text, /^🟠 \*Hers\* — due tomorrow · \*Laura E\.\*$/m);
  assert.match(buildText(weekly, tasks, settings, MONDAY, { preview: true }).text, /— due tomorrow · @@Tim Wallace@@$/m);
  const slack = { ...weekly, platform: "slack" };
  assert.match(buildText(slack, tasks, { people: [{ email: "tim@zinspector.com", slackId: "U1" }] }, MONDAY).text, /· <@U1>$/m);
});

test("stays quiet when nothing matches", () => {
  assert.equal(buildText(weekly, [task({ status: "Closed", due: "2026-10-27" })], {}, MONDAY), null);
  assert.equal(buildText(weekly, [task({})], {}, MONDAY), null); // no due date
});

test("titles that would break a chat link are cleaned", () => {
  const { text } = buildText(weekly, [task({ id: "9", description: "A <b>|c> task", due: "2026-10-27" })], { taskUrl: "https://z/{id}" }, MONDAY);
  assert.match(text, /<https:\/\/z\/9\|A b – c task>/);
  const pipe = buildText(weekly, [task({ id: "8", description: "PTN | 2027 Reunion & Sponsorships", due: "2026-10-27" })], { taskUrl: "https://z/{id}" }, MONDAY);
  assert.match(pipe.text, /<https:\/\/z\/8\|PTN – 2027 Reunion & Sponsorships>/);
});

test("without an API key, Send the summary now lists the tasks the app has seen", async () => {
  const env = makeEnv();
  const c = await (await admin(env, "POST", "/api/connections", { name: "Marketing tasks", platform: "google-chat", chatUrl: GCHAT_URL, summary: { onlyDated: false } })).json();
  await withChat(200, async (calls) => {
    await hook(env, c.id, created);
    await hook(env, c.id, withStatus("Work Complete"));
    await hook(env, c.id, { ...created, data: { ...created.data, id: 99, description: "Second task" } });
    const res = await (await admin(env, "POST", `/api/connections/${c.id}/digest`)).json();
    assert.equal(res.ok, true);
    const body = calls.at(-1).body;
    const lines = cardLines(body);
    const at = lines.indexOf("## 📅 No due date · 1 new");
    assert.ok(at >= 0);
    assert.equal(lines[at + 1], '<b>Second task</b><br><font color="#5f6368">no due date</font> · Tania Aquirre');
    assert.ok(lines.includes("Last week the team opened 2 and wrapped up 1 🎉"));
    assert.ok(lines.includes("Nothing past due 👍"));
  });
});

test("the hourly cron sends each chat's summary on its days at its hour, and any number of days ahead is kept", async () => {
  const env = makeEnv();
  const make = async (name, summary) =>
    (await admin(env, "POST", "/api/connections", { name, platform: "google-chat", chatUrl: GCHAT_URL, summary: { onlyDated: false, ...summary } })).json();
  const d = await make("D", { postDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], hour: 8, days: 5 });
  const w = await make("W", { postDays: ["Mon"], hour: 8, days: 10 });
  const a = await make("A", { postDays: ["Tue", "Thu"], hour: 15, days: 15 });
  await make("O", { postDays: [] });
  assert.deepEqual([d.summary.days, w.summary.days, a.summary.days], [5, 10, 15]);
  assert.equal((await make("X", { days: 61 })).summary.days, 7); // out of range: the default
  await withChat(200, async (calls) => {
    for (const c of [d, w, a]) await hook(env, c.id, { ...created, data: { ...created.data, description: c.name } });
    const run = async (iso) => {
      const before = calls.length;
      const pending = [];
      await worker.scheduled({ scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      return calls.slice(before).map((c) => cardLines(c.body).join("\n").match(/<b>(D|W|A)<\/b>/)[1]);
    };
    assert.deepEqual(await run("2026-10-26T16:30:00Z"), []); // Monday 9:30 Pacific
    assert.deepEqual(await run("2026-10-26T15:30:00Z"), ["D", "W"]); // Monday 8:30
    assert.deepEqual(await run("2026-10-27T15:30:00Z"), ["D"]); // Tuesday 8:30
    assert.deepEqual(await run("2026-10-27T22:30:00Z"), ["A"]); // Tuesday 3:30pm
    assert.deepEqual(await run("2026-10-31T15:30:00Z"), []); // Saturday
  });
});

// A fake zInspector API next to the fake chat: answers property searches and task lists.
async function withZinspector(fn) {
  const real = globalThis.fetch;
  const calls = { chat: [], api: [] };
  const properties = [
    { id: 903925, Name: "Marketing.Conferences" },
    { id: 2206214, Name: "Marketing.BizDev.Strategic" },
    { id: 2962118, Name: "Marketing.BizDev.Enterprise" },
    { id: 1824059, Name: "Z.0000018899.Skyline Marketing Realty Inc." },
  ];
  const tasks = {
    903925: [
      { id: 1814733, Description: "Conference: PTN | 2026 RPM Franchise Conference", Status: "Approval Requested", EndDate: new Date(Date.now() + 3 * 864e5).toISOString(), AssignedToUser: 35634, AssignedToUserName: "Tim Wallace", Property: 903925, PropertyName: "Marketing.Conferences" },
      { id: 1814734, Description: "Unassigned conference", Status: "New", EndDate: "2026-10-28T19:00:00+00:00", AssignedToUser: null, AssignedToUserName: "", Property: 903925, PropertyName: "Marketing.Conferences" },
    ],
    2206214: [
      { id: 2160227, Description: "Idea: a chat message when a task is assigned to you", Status: "In Progress", EndDate: new Date(Date.now() - 5 * 864e5).toISOString(), AssignedToUser: 35634, AssignedToUserName: "Tim Wallace", Property: 2206214, PropertyName: "Marketing.BizDev.Strategic" },
    ],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "portfolio.zinspector.com") {
      calls.api.push({ url: u, headers: init.headers });
      if (init.headers["x-api-key"] !== "KEY") return new Response('{"detail":"Invalid key"}', { status: 403 });
      if (u.pathname === "/api/propertiesCursor/") {
        const q = u.searchParams.get("search").toLowerCase();
        return Response.json({ results: properties.filter((p) => p.Name.toLowerCase().includes(q)), next: null });
      }
      if (u.pathname === "/api/task/todos/") {
        if (u.searchParams.get("Task") !== "1814733") return Response.json({ results: [], next: null });
        return Response.json({ results: [
          { id: 0, Task: 1814733, Description: "Documents", Completed: true, Order: 9, Type: "DOCUMENT" },
          { id: 3, Task: 1814733, Description: "20-minute sessions", Completed: true, Order: 0, Type: "NOTE" },
          { id: 1, Task: 1814733, Description: "Send pre-conference email", Completed: true, Order: 0, Type: "BOOLEAN" },
          { id: 2, Task: 1814733, Description: "Get attendee list", Completed: false, Order: 1 },
        ], next: null });
      }
      if (u.pathname === "/api/user/") return Response.json([{ id: 35634, FirstName: "Tim", LastName: "Wallace", email: "tim+onsight@zinspector.com" }]);
      if (u.pathname === "/api/tasks/") {
        assert.equal(u.searchParams.get("active"), "true");
        return Response.json({ results: tasks[u.searchParams.get("Property")] || [], next: null });
      }
      return new Response("not found", { status: 404 });
    }
    calls.chat.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("with an API key, saving looks up the properties and the summary reads their open tasks from zInspector", async () => {
  const env = { ...makeEnv(), ZINSPECTOR_API_KEY: "KEY" };
  await withZinspector(async (calls) => {
    await admin(env, "GET", "/api/state"); // remembers this app's address for zInspector's whitelist
    await admin(env, "PUT", "/api/settings", { people: [{ email: "tim@zinspector.com", googleChatId: "777" }] });
    const summary = { schedule: "daily", onlyProperties: true, propertyLines: ["Marketing.Conferences", "marketing.bizdev*", ""] };
    const c = await (await admin(env, "POST", "/api/connections", { name: "Mkt", platform: "google-chat", chatUrl: GCHAT_URL, summary })).json();
    assert.deepEqual(c.summary.properties, [
      { label: "Marketing.Conferences", name: "Marketing.Conferences", ids: [903925] },
      { label: "marketing.bizdev*", name: "marketing.bizdev*", ids: [2206214, 2962118] },
    ]);

    const res = await (await admin(env, "POST", `/api/connections/${c.id}/digest`)).json();
    assert.equal(res.ok, true);
    const reads = calls.api.filter((a) => a.url.pathname === "/api/tasks/");
    assert.deepEqual(reads.map((a) => a.url.searchParams.get("Property")), ["903925", "2206214", "2962118"]);
    assert.equal(reads[0].headers.Origin, ORIGIN);
    const posted = calls.chat.map((c) => c.body);
    // The summary, then the tags as a reply in its thread.
    assert.deepEqual(posted.map((b) => (b.cardsV2 ? "cards" : "text")), ["cards", "text"]);
    const urls = calls.chat.map((c) => new URL(c.url).searchParams);
    assert.ok(urls.every((p) => p.get("threadKey") === urls[0].get("threadKey") && p.get("threadKey").startsWith("summary-")));
    assert.equal(urls[0].get("messageReplyOption"), "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    assert.equal(posted[1].text, "👆 <users/777>: you have tasks above. Already done? Close it in zInspector so it drops off. Plans changed? Update the due date.");
    const lines = posted.flatMap(cardLines).join("\n");
    // Two areas in this summary, so each task says which.
    assert.match(lines, /## 🔴 Past due · 1\nBizDev \/ Strategic \| <b>Idea: a chat message[^<]*<\/b><br><font color="#d93025">5 days overdue<\/font> · Tim Wallace\n/);
    assert.match(lines, /## 🗓️ Coming up · 1\nConferences \| <b>Conference: PTN[^<]*<\/b><br><font color="#5f6368">due \w+<\/font> · Tim Wallace · Next: Get attendee list \(1 of 2\)/);
  });
});

test("an unknown property name or a refused key is explained when saving", async () => {
  const env = { ...makeEnv(), ZINSPECTOR_API_KEY: "KEY" };
  await withZinspector(async () => {
    const save = (summary, e = env) => admin(e, "POST", "/api/connections", { name: "Mkt", platform: "google-chat", chatUrl: GCHAT_URL, summary });
    const missing = await save({ onlyProperties: true, propertyLines: ["Marketing.Nope"] });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /Couldn't find the property "Marketing.Nope"/);
    const refused = await save({ onlyProperties: true, propertyLines: ["Marketing.Conferences"] }, { ...env, ZINSPECTOR_API_KEY: "WRONG" });
    assert.match((await refused.json()).error, /zInspector refused the API key/);
    const byLink = await (await save({ onlyProperties: true, propertyLines: ["https://dashboard.zinspector.com/property/view/903925"] })).json();
    assert.deepEqual(byLink.summary.properties[0].ids, [903925]);
  });
});

test("the property picker searches zInspector's properties by name", async () => {
  const env = { ...makeEnv(), ZINSPECTOR_API_KEY: "KEY" };
  await withZinspector(async () => {
    const found = await (await admin(env, "GET", "/api/properties?q=bizdev")).json();
    assert.deepEqual(found, [
      { id: 2962118, name: "Marketing.BizDev.Enterprise" },
      { id: 2206214, name: "Marketing.BizDev.Strategic" },
    ]);
    assert.equal((await admin(env, "GET", "/api/properties?q=b")).status, 400);
    assert.equal((await admin(makeEnv(), "GET", "/api/properties?q=bizdev")).status, 400); // no API key
    const picked = { onlyProperties: true, properties: found.map((p) => ({ label: p.name, name: p.name, ids: [p.id] })) };
    const c = await (await admin(env, "POST", "/api/connections", { name: "Mkt", platform: "google-chat", chatUrl: GCHAT_URL, summary: picked })).json();
    assert.deepEqual(c.summary.properties.map((p) => p.ids[0]), [2962118, 2206214]);
  });
});

test("Preview the summary shows the text with the form's unsaved settings, and posts nothing", async () => {
  const env = makeEnv();
  const c = await (await admin(env, "POST", "/api/connections", { name: "Mkt", platform: "google-chat", chatUrl: GCHAT_URL })).json();
  await withChat(200, async (calls) => {
    await hook(env, c.id, created);
    const posted = calls.length;
    const preview = (summary) => admin(env, "POST", `/api/connections/${c.id}/digest`, { preview: true, summary }).then((r) => r.json());
    assert.equal((await preview({})).empty, true); // the task has no due date
    const r = await preview({ onlyDated: false, intro: "Hello [Chat name]" });
    assert.equal(r.ok, true);
    assert.match(r.messages[0].text, /^Hello Mkt/);
    assert.ok(r.messages.length >= 1 && r.messages[0].cards.length >= 2);
    assert.equal(calls.length, posted);
    const saved = (await (await admin(env, "GET", "/api/state")).json()).connections[0].summary;
    assert.equal(saved.intro, ""); // previewing doesn't save
  });
});
