import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, deliveryUrl } from "../src/messages.js";
import { created, withStatus, GCHAT_URL } from "./helpers.js";

test("new task message reads like the spec example", () => {
  assert.equal(
    buildMessage(created),
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

test("mentions the assignee in the chat app's own syntax when their id is on file", () => {
  const settings = { people: [{ email: "Tania@zInspector.com", googleChatId: "1234", slackId: "U99" }] };
  assert.match(buildMessage(created, settings, "google-chat"), /Assigned to <users\/1234>/);
  assert.match(buildMessage(created, settings, "slack"), /Assigned to <@U99>/);
});

test("leaves out lines whose value is empty", () => {
  const text = buildMessage({ ...created, data: { ...created.data, description: "", referenceNumber: null } });
  assert.doesNotMatch(text, /Ref|>/);
  assert.doesNotMatch(text, /\n\n\n/);
});

test("adds a task link when one is set", () => {
  const text = buildMessage(created, { taskUrl: "https://zi.example/task/{id}" });
  assert.match(text, /<https:\/\/zi\.example\/task\/2160012\|Open in zInspector>$/);
});

test("an update to a done status celebrates; any other status is an update", () => {
  assert.match(buildMessage(withStatus("Completed")), /^🎉 🎉 \*Task completed!\*/);
  assert.match(buildMessage(withStatus("Finished"), { completedStatuses: "Finished" }), /Task completed/);
  assert.match(buildMessage(withStatus("In Progress")), /^✏️ \*Task updated:\* Marketing Required/);
});

test("Google Chat messages for one task share a thread and keep the URL's key and token", () => {
  const url = new URL(deliveryUrl({ platform: "google-chat", chatUrl: GCHAT_URL }, created));
  assert.equal(url.searchParams.get("threadKey"), "task-2160012");
  assert.equal(url.searchParams.get("key"), "K");
  assert.equal(url.searchParams.get("token"), "T");
  const slack = "https://hooks.slack.com/services/X";
  assert.equal(deliveryUrl({ platform: "slack", chatUrl: slack }, created), slack);
});
