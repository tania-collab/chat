import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, isSummaryTime, selectTasks, summaryOf, SUMMARY_DEFAULTS } from "../src/digest.js";
import worker from "../src/worker.js";
import { makeEnv, admin, hook, withChat, created, withStatus, GCHAT_URL, ORIGIN } from "./helpers.js";

const MONDAY = new Date("2026-10-26T15:30:00Z"); // 8:30am in Los Angeles (daylight saving)
const weekly = { name: "Marketing tasks", platform: "google-chat", summary: { schedule: "weekly" } };
const daily = { ...weekly, summary: { schedule: "daily" } };
const tim = { name: "Tim Wallace", email: "tim+onsight@zinspector.com" };
const laura = { name: "Laura E.", email: "laura@zinspector.com" };
let nextId = 1;
const task = (over) => ({ id: String(nextId++), status: "New", assignee: tim, description: "A task", due: null, next: "", ...over });
const all = { ...SUMMARY_DEFAULTS, onlyDated: false, onlyAssigned: false, days: 30 };

test("daily summaries go out weekday mornings, weekly ones Monday mornings, 8:30 Pacific all year", () => {
  assert.equal(isSummaryTime("weekly", new Date("2026-10-26T15:30:00Z")), true); // Monday, PDT
  assert.equal(isSummaryTime("weekly", new Date("2026-10-26T16:30:00Z")), false); // 9:30
  assert.equal(isSummaryTime("weekly", new Date("2026-12-07T16:30:00Z")), true); // Monday, PST
  assert.equal(isSummaryTime("weekly", new Date("2026-12-08T16:30:00Z")), false); // Tuesday
  assert.equal(isSummaryTime("daily", new Date("2026-12-08T16:30:00Z")), true); // Tuesday
  assert.equal(isSummaryTime("daily", new Date("2026-12-12T16:30:00Z")), false); // Saturday
  assert.equal(isSummaryTime("off", new Date("2026-12-07T16:30:00Z")), false);
});

test("chats from before the summary keep their weekly digest, or stay off if it was off", () => {
  assert.equal(summaryOf({}).schedule, "weekly");
  assert.equal(summaryOf({ alerts: { digest: false } }).schedule, "off");
  assert.equal(summaryOf({ alerts: { digest: false }, summary: { schedule: "daily" } }).schedule, "daily");
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

  const { text } = buildDigest({ ...weekly, summary: { schedule: "weekly", owners: "anyone" } }, tasks, {}, MONDAY);
  assert.match(text, /^\*Laura E\.\* · 1 task\n🟠 \*next\* — due tomorrow · you're next$/m);
  assert.match(text, /^\*Athina G\.\* · 1 task\n🟠 \*managed\* — due tomorrow · you manage it$/m);
  assert.match(text, /🟠 \*assigned\* — due tomorrow · next: \*Laura E\.\*$/m);
});

test("chats saved with the old assigned checkbox keep their choice", () => {
  assert.equal(summaryOf({ summary: { onlyAssigned: true } }).owners, "assigned");
  assert.equal(summaryOf({ summary: { onlyAssigned: false } }).owners, "anyone");
  assert.equal(summaryOf({}).owners, "assigned-or-next");
});

test("a property chosen by id matches tasks on it", () => {
  const tasks = [task({ due: "2026-10-27", propertyId: 42 }), task({ due: "2026-10-27", propertyId: 7 })];
  const summary = { ...SUMMARY_DEFAULTS, onlyProperties: true, properties: [{ label: "42", name: "", ids: [42] }] };
  assert.equal(selectTasks(tasks, summary, {}, MONDAY).length, 1);
});

test("the weekly summary: each person @mentioned, overdue first, with due notes, statuses, next to-do and last week's numbers", () => {
  const tasks = [
    task({ id: "1", description: "webchatTEST", due: "2026-10-23", status: "In Progress", nextPerson: laura, createdAt: "2026-10-20T10:00:00Z" }),
    task({ id: "2", description: "Sponsor Sessions – PMSC 2027", due: "2026-10-28" }),
    task({ id: "3", description: "Email Campaigns", assignee: laura, due: "2026-10-27" }),
    task({ id: "4", description: "Done thing", status: "Work Complete", finishedAt: "2026-10-22T10:00:00Z" }),
  ];
  const settings = { taskUrl: "https://z/task/{id}", people: [{ email: "tim@zinspector.com", googleChatId: "111" }] };
  const { text } = buildDigest(weekly, tasks, settings, MONDAY, { pulse: true });
  assert.equal(
    text,
    [
      "👋 *Happy Monday, Marketing tasks!* Here's the week of Oct 26",
      "_2 due in the next 7 days · 1 overdue_",
      "<users/111> · 2 tasks, 1 overdue\n" +
        "🔴 <https://z/task/1|webchatTEST> — 3 days overdue · In Progress · next: *Laura E.*\n" +
        "🔹 <https://z/task/2|Sponsor Sessions – PMSC 2027> — due Wed",
      "*Laura E.* · 1 task\n🟠 <https://z/task/3|Email Campaigns> — due tomorrow",
      "Last week: 1 new · 1 finished 🎉\n<https://dashboard.zinspector.com/|Open zInspector>",
    ].join("\n\n"),
  );
});

test("the daily summary opens with the day; the opening line can be reworded with details", () => {
  const one = [task({ due: "2026-10-26" })];
  assert.match(buildDigest(daily, one, {}, MONDAY).text, /^☀️ \*Good morning, Marketing tasks!\* Here's what's coming up \(Mon, Oct 26\)\n\n/);
  assert.match(buildDigest(daily, one, {}, MONDAY).text, /A task\* — due today\n\nNothing overdue 👏/);
  const reworded = { ...daily, summary: { schedule: "daily", intro: "[Chat name]: [Due count] due, [Overdue count] late, [Unknown]" } };
  assert.match(buildDigest(reworded, one, {}, MONDAY).text, /^Marketing tasks: 1 due, 0 late, \[Unknown\]\n/);
});

test("each person is @mentioned when their chat id is on file, else named in bold; the preview shows names", () => {
  const settings = { people: [{ email: "tim@zinspector.com", googleChatId: "111" }] };
  const tasks = [task({ due: "2026-10-27" }), task({ assignee: laura, due: "2026-10-27" })];
  const { text } = buildDigest(weekly, tasks, settings, MONDAY);
  assert.match(text, /^<users\/111> · 1 task$/m);
  assert.match(text, /^\*Laura E\.\* · 1 task$/m);
  assert.match(buildDigest(weekly, tasks, settings, MONDAY, { preview: true }).text, /^@@Tim Wallace@@ · 1 task$/m);
  const slack = { ...weekly, platform: "slack" };
  assert.match(buildDigest(slack, tasks, { people: [{ email: "tim@zinspector.com", slackId: "U1" }] }, MONDAY).text, /^<@U1> · 1 task$/m);
});

test("stays quiet when nothing matches", () => {
  assert.equal(buildDigest(weekly, [task({ status: "Closed", due: "2026-10-27" })], {}, MONDAY), null);
  assert.equal(buildDigest(weekly, [task({})], {}, MONDAY), null); // no due date
});

test("titles that would break a chat link are cleaned", () => {
  const { text } = buildDigest(weekly, [task({ id: "9", description: "A <b>|c> task", due: "2026-10-27" })], { taskUrl: "https://z/{id}" }, MONDAY);
  assert.match(text, /<https:\/\/z\/9\|A  b  c  task>/);
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
    const { text } = calls.at(-1).body;
    assert.match(text, /^_1 with no due date_$/m);
    assert.match(text, /Last week: 2 new · 1 finished 🎉\nNothing overdue 👏\n/);
  });
});

test("the cron sends daily summaries on weekdays and weekly ones on Mondays, at 8:30 Pacific", async () => {
  const env = makeEnv();
  const make = async (name, schedule) =>
    (await admin(env, "POST", "/api/connections", { name, platform: "google-chat", chatUrl: GCHAT_URL, summary: { schedule, onlyDated: false } })).json();
  const d = await make("D", "daily");
  const w = await make("W", "weekly");
  await make("O", "off");
  await withChat(200, async (calls) => {
    await hook(env, d.id, created);
    await hook(env, w.id, created);
    const run = async (iso) => {
      const before = calls.length;
      const pending = [];
      await worker.scheduled({ scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      return calls.slice(before).map((c) => c.body.text.match(/(morning|Monday), (\w+)!/)[2]);
    };
    assert.deepEqual(await run("2026-10-26T16:30:00Z"), []); // 9:30 Pacific
    assert.deepEqual(await run("2026-10-26T15:30:00Z"), ["D", "W"]); // Monday
    assert.deepEqual(await run("2026-10-27T15:30:00Z"), ["D"]); // Tuesday
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
    const { text } = calls.chat.at(-1).body;
    assert.match(text, /^<users\/777> · 2 tasks, 1 overdue\n🔴 .*Idea: a chat message.* — 5 days overdue · In Progress\n🔹 .*Conference: PTN.* — due \w+ · Approval Requested$/m);
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
    assert.match(r.preview, /^Hello Mkt\n/);
    assert.equal(calls.length, posted);
    const saved = (await (await admin(env, "GET", "/api/state")).json()).connections[0].summary;
    assert.equal(saved.intro, ""); // previewing doesn't save
  });
});
