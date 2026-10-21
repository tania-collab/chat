import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, render, eventKind, deliveryUrl, fieldPaths, defaultTemplates, DEFAULT_TASK_URL } from "../src/messages.js";
import { snapshotOf } from "../src/taskview.js";
import { created, withStatus, GCHAT_URL } from "./helpers.js";

const ALL_ALERTS = { created: true, assigned: true, completed: true, changes: true, messages: true };
const gchat = { platform: "google-chat", chatUrl: GCHAT_URL, templates: defaultTemplates(), alerts: ALL_ALERTS };
const withLink = { taskUrl: DEFAULT_TASK_URL };
const update = (data) => ({ ...created, type: "task.updated", data: { ...created.data, ...data } });

test("a new task fits in a few lines, with the task name as its link", () => {
  const event = { ...created, data: { ...created.data, endDate: "2026-10-30", priority: 4 } };
  assert.equal(
    buildMessage(event, gchat, withLink),
    [
      "🆕 *New task* · <https://dashboard.zinspector.com/task/view/2160012|Marketing Required> · Ref 313307",
      "🏠 Marketing.Conferences · 123 Jones, Davis, CA 95616, US",
      "👤 *Tania Aquirre* · 📅 Due Oct 30 · 🔺 High priority",
      "> test task",
    ].join("\n"),
  );
});

test("says when a new task has nobody on it (for chats that get all tasks), and leaves out normal priority and missing dates", () => {
  const text = buildMessage({ ...created, data: { ...created.data, assignedTo: null } }, { ...gchat, only: "all" });
  assert.match(text, /👤 _Unassigned_$/m);
  assert.doesNotMatch(text, /priority|Due/);
});

test("shows a vendor when the task is assigned to a contact", () => {
  const event = { ...created, data: { ...created.data, assignedTo: null, assignedToContact: { name: "Acme Painting" } } };
  assert.match(buildMessage(event, gchat), /👤 \*Acme Painting\*/);
});

test("an update lists only what changed", () => {
  const before = snapshotOf(created.data);
  const event = update({
    status: { id: 2, value: "In Progress" },
    assignedTo: { name: "Tim Wallace", email: "tim+onsight@zinspector.com" },
    endDate: "2026-11-02",
    priority: 5,
  });
  const settings = { people: [{ email: "tim@zinspector.com", googleChatId: "110410588780324983531" }] };
  assert.equal(
    buildMessage(event, gchat, settings, before),
    [
      "✏️ *Marketing Required* · Ref 313307",
      "• Status: New → *In Progress*",
      "• Assigned: Tania Aquirre → <users/110410588780324983531>",
      "• Due: *Nov 2*",
      "• Priority: Normal → *Highest*",
    ].join("\n"),
  );
});

test("an update that changed nothing visible isn't posted", () => {
  assert.equal(buildMessage(update({}), gchat, {}, snapshotOf(created.data)), null);
});

test("the first update of a task the chat never saw isn't posted", () => {
  assert.equal(buildMessage(update({ status: { value: "In Progress" } }), gchat), null);
  assert.equal(eventKind(withStatus("Work Complete")), "task.updated");
});

test("a completion counts once: when the status moves into a done status", () => {
  const inProgress = snapshotOf({ ...created.data, status: { value: "In Progress" } });
  const done = snapshotOf({ ...created.data, status: { value: "Work Complete" } });
  assert.equal(eventKind(withStatus("Work Complete"), {}, inProgress), "task.completed");
  assert.equal(eventKind(withStatus("Closed"), {}, done), "task.updated");
  assert.equal(eventKind(withStatus("Finished"), { completedStatuses: "Finished" }, inProgress), "task.completed");
  assert.equal(eventKind({ type: "zdata.changed" }), "zdata.changed");
  assert.equal(eventKind({ type: "something.new" }), "other");
});

test("a new message shows its author and the first lines, without signature or HTML", () => {
  const event = {
    type: "task.message.created",
    data: { ...created.data, message: { author: "Greg Owen", body_html: "x", body_text: "If this shows up as a task, we're ready.\n\n-- \nGreg Owen • CTO\n423.244.0953" } },
  };
  assert.equal(
    buildMessage(event, gchat),
    "💬 *New message* · *Marketing Required* · Ref 313307\n> If this shows up as a task, we're ready.\n— Greg Owen",
  );
  const html = { type: "task.message.created", data: { comment: "<div>Hello <b>there</b>&nbsp;team</div><div>On Mon, Oct 20 Ann wrote:</div>" } };
  assert.match(buildMessage(html, { ...gchat, only: "all" }), /> Hello there team$/m);
  // Without people on the event, a message follows the task's last known state.
  assert.equal(buildMessage(html, gchat), null);
  assert.match(buildMessage(html, gchat, {}, snapshotOf(created.data)), /> Hello there team$/m);
});

test("uses the connection's own edited copy", () => {
  const connection = { ...gchat, templates: { ...gchat.templates, "task.created": "New {{data.type}} for {{data.assignedTo}} ({{data.status}})" } };
  assert.equal(buildMessage(created, connection), "New Marketing Required for Tania Aquirre (New)");
});

test("leaves out a line, or a part of one, whose field is empty", () => {
  const event = { type: "x", data: { a: "A", b: "", c: null } };
  assert.equal(render("Head\n1: {{data.a}} · 2: {{data.b}}\nOnly {{data.c}}\n{{data.missing}} · {{data.b}}\nTail", event), "Head\n1: A\nTail");
});

test("doesn't mistake built-in object names for fields", () => {
  assert.equal(render("x{{toString}}y\nz {{constructor}}", { type: "t" }), "");
});

test("mentions in the chat app's own syntax, matching emails with or without a +tag", () => {
  const settings = { people: [{ email: "Tania@zInspector.com", googleChatId: "1234", slackId: "U99" }] };
  const tagged = { ...created, data: { ...created.data, assignedTo: { name: "T", email: "tania+onsight@zinspector.com" } } };
  assert.match(buildMessage(tagged, gchat, settings), /👤 <users\/1234>/);
  assert.match(buildMessage(tagged, { ...gchat, platform: "slack" }, settings), /👤 <@U99>/);
});

test("lists an event's fields for the template helper", () => {
  const fields = fieldPaths(created);
  for (const f of ["type", "data.propertyName", "data.status", "data.assignedTo"]) assert.ok(fields.includes(f), f);
});

test("Google Chat groups a task's messages in one thread and keeps the URL's key and token", () => {
  const url = new URL(deliveryUrl(gchat, created));
  assert.equal(url.searchParams.get("threadKey"), "task-2160012");
  assert.equal(url.searchParams.get("key"), "K");
  assert.equal(url.searchParams.get("token"), "T");
  assert.equal(deliveryUrl(gchat, { type: "zdata.changed", data: { id: 5 } }), GCHAT_URL);
  const slack = "https://hooks.slack.com/services/X";
  assert.equal(deliveryUrl({ platform: "slack", chatUrl: slack }, created), slack);
});
