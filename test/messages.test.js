import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, render, eventKind, deliveryUrl, fieldPaths, defaultTemplates } from "../src/messages.js";
import { created, withStatus, GCHAT_URL } from "./helpers.js";

const gchat = { platform: "google-chat", chatUrl: GCHAT_URL, templates: defaultTemplates() };

test("new task message reads like the spec example", () => {
  assert.equal(
    buildMessage(created, gchat),
    [
      "✨ *We have a new task!* ✨",
      "",
      "📋 *Marketing Required*",
      "🏠 Marketing.Conferences · 123 Jones, Davis, CA 95616, US",
      "👤 Assigned to *Tania Aquirre*",
      "🎯 Status: New · Priority: 3",
      "#️⃣ Ref 313307",
      "",
      "> test task",
    ].join("\n"),
  );
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

test("mentions the assignee in the chat app's own syntax when their id is on file", () => {
  const settings = { people: [{ email: "Tania@zInspector.com", googleChatId: "1234", slackId: "U99" }] };
  assert.match(buildMessage(created, gchat, settings), /Assigned to <users\/1234>/);
  assert.match(buildMessage(created, { ...gchat, platform: "slack" }, settings), /Assigned to <@U99>/);
});

test("adds a task link when one is set", () => {
  const text = buildMessage(created, gchat, { taskUrl: "https://zi.example/task/{id}" });
  assert.match(text, /<https:\/\/zi\.example\/task\/2160012\|Open in zInspector>$/);
});

test("picks the template for each zInspector event", () => {
  assert.equal(eventKind(withStatus("Completed")), "task.completed");
  assert.equal(eventKind(withStatus("Finished"), { completedStatuses: "Finished" }), "task.completed");
  assert.equal(eventKind(withStatus("In Progress")), "task.updated");
  assert.equal(eventKind({ type: "zdata.changed" }), "zdata.changed");
  assert.equal(eventKind({ type: "task.message.created" }), "task.message.created");
  assert.equal(eventKind({ type: "something.new" }), "other");
  assert.match(buildMessage({ type: "something.new", data: {} }, gchat), /zInspector: something\.new/);
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
