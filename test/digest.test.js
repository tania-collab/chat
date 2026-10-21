import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, isDigestTime } from "../src/digest.js";
import worker from "../src/worker.js";
import { makeEnv, admin, hook, withChat, created, withStatus, GCHAT_URL } from "./helpers.js";

const MONDAY = new Date("2026-10-26T15:30:00Z"); // 8:30am in Los Angeles (daylight saving)
const chat = { name: "Marketing tasks", platform: "google-chat", only: "assigned" };
const tim = { name: "Tim Wallace", email: "tim+onsight@zinspector.com" };
const laura = { name: "Laura E.", email: "laura@zinspector.com" };
const task = (over) => ({ status: "New", assignee: tim, description: "A task", due: null, next: "", ...over });

test("runs Mondays at 8:30am Pacific, in summer and winter time", () => {
  assert.equal(isDigestTime(new Date("2026-10-26T15:30:00Z")), true); // PDT
  assert.equal(isDigestTime(new Date("2026-10-26T16:30:00Z")), false);
  assert.equal(isDigestTime(new Date("2026-12-07T16:30:00Z")), true); // PST
  assert.equal(isDigestTime(new Date("2026-12-08T16:30:00Z")), false); // a Tuesday
});

test("lists open tasks per person, overdue first, with due notes and last week's numbers", () => {
  const activity = {
    tasks: {
      1: task({ description: "webchatTEST", due: "2026-10-23", createdAt: "2026-10-20T10:00:00Z" }),
      2: task({ description: "Sponsor Sessions – PMSC 2027", due: "2026-10-28" }),
      3: task({ description: "Email Campaigns", assignee: laura, due: "2026-11-12" }),
      4: task({ description: "Done thing", status: "Work Complete", finishedAt: "2026-10-22T10:00:00Z" }),
      5: task({ description: "Canceled thing", status: "Canceled" }),
      6: task({ description: "Inbox email", assignee: null, next: "Laura E." }),
    },
  };
  const { card } = buildDigest(chat, activity, { taskUrl: "https://z/task/{id}" }, MONDAY).cardsV2[0];
  assert.deepEqual(card.header, { title: "Week of Oct 26 — Marketing tasks", subtitle: "3 open · 1 overdue · 1 due this week" });
  assert.equal(card.sections[0].header, "Tim Wallace — 2 open (1 overdue)");
  assert.equal(
    card.sections[0].widgets[0].textParagraph.text,
    '• <a href="https://z/task/1">webchatTEST</a> · overdue since Fri<br>• <a href="https://z/task/2">Sponsor Sessions – PMSC 2027</a> · due Wed',
  );
  assert.equal(card.sections[1].header, "Laura E. — 1 open");
  assert.match(card.sections[1].widgets[0].textParagraph.text, /Email Campaigns<\/a> · due Nov 12$/);
  assert.equal(card.sections[2].widgets[0].textParagraph.text, "Last week: 1 new · 1 finished 🎉");
});

test("@mentions only people with overdue tasks whose chat id is on file", () => {
  const activity = { tasks: { 1: task({ due: "2026-10-20" }), 2: task({ assignee: laura, due: "2026-10-20" }) } };
  const settings = { people: [{ email: "tim@zinspector.com", googleChatId: "111" }] };
  assert.equal(buildDigest(chat, activity, settings, MONDAY).text, "<users/111> — you have overdue tasks");
  assert.equal(buildDigest(chat, { tasks: { 1: task({ due: "2026-10-30" }) } }, settings, MONDAY).text, undefined);
});

test("names the week by its Monday, whatever day it's sent", () => {
  const { card } = buildDigest(chat, { tasks: { 1: task({}) } }, {}, new Date("2026-10-29T18:00:00Z")).cardsV2[0];
  assert.equal(card.header.title, "Week of Oct 26 — Marketing tasks");
});

test("stays quiet when nothing is open and nothing happened", () => {
  assert.equal(buildDigest(chat, { tasks: { 1: task({ status: "Closed" }) } }, {}, MONDAY), null);
});

test("Slack gets the digest as text", () => {
  const { text } = buildDigest({ ...chat, platform: "slack" }, { tasks: { 1: task({ due: "2026-10-27" }) } }, {}, MONDAY);
  assert.match(text, /^\*Week of Oct 26 — Marketing tasks\*\n1 open · 1 due this week\n\n\*Tim Wallace — 1 open\*\n• A task · due Tue/);
});

test("the app tracks tasks from webhooks, and Send digest now posts the card", async () => {
  const env = makeEnv();
  const c = await (await admin(env, "POST", "/api/connections", { name: "Marketing tasks", platform: "google-chat", chatUrl: GCHAT_URL })).json();
  await withChat(200, async (calls) => {
    await hook(env, c.id, created);
    await hook(env, c.id, withStatus("Work Complete"));
    await hook(env, c.id, { ...created, data: { ...created.data, id: 99, description: "Second task" } });
    const res = await (await admin(env, "POST", `/api/connections/${c.id}/digest`)).json();
    assert.equal(res.ok, true);
    const card = calls.at(-1).body.cardsV2[0].card;
    assert.equal(card.header.subtitle, "1 open");
    assert.equal(card.sections.at(-1).widgets[0].textParagraph.text, "Last week: 2 new · 1 finished 🎉<br>Nothing overdue 👏");
  });
});

test("the Monday cron sends each chat's digest, only at 8:30 Pacific", async () => {
  const env = makeEnv();
  const c = await (await admin(env, "POST", "/api/connections", { name: "M", platform: "google-chat", chatUrl: GCHAT_URL })).json();
  await withChat(200, async (calls) => {
    await hook(env, c.id, created);
    const run = async (iso) => {
      const pending = [];
      await worker.scheduled({ scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
    };
    await run("2026-10-26T16:30:00Z"); // 9:30 Pacific: skipped
    assert.equal(calls.length, 1);
    await run("2026-10-26T15:30:00Z");
    assert.equal(calls.length, 2);
    assert.ok(calls[1].body.cardsV2[0].card.header.title.endsWith("— M"));
  });
});
