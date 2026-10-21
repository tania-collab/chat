import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { buildMessage, threadUrl } from "./worker.js";

// The task.created event zInspector sent on 2026-10-21 (captured through Zapier).
const created = {
  id: "e694ccb2-d767-4837-b8df-71ad91f08331",
  type: "task.created",
  version: 1,
  occurredAt: "2026-10-21T21:21:48.329392+00:00",
  data: {
    id: 2160012,
    type: "Marketing Required",
    status: { id: 1, value: "New" },
    priority: 3,
    assignedTo: { id: 42116, name: "Tania Aquirre", email: "tania@zinspector.com" },
    propertyName: "Marketing.Conferences",
    propertyAddress: "123 Jones, Davis, CA 95616, US",
    referenceNumber: "313307",
    description: "test task",
  },
};
const CHAT = "https://chat.googleapis.com/v1/spaces/AAA/messages?key=K&token=T";
const ENV = { ROUTES: JSON.stringify({ marketing: { chat: CHAT, token: "secret-1" } }) };

const post = (path, body, token = "secret-1") =>
  new Request(`https://relay.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-zInspector-Webhook-Token": token },
    body: JSON.stringify(body),
  });

function withChatStub(status, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(status === 200 ? "{}" : "bad", { status });
  };
  return fn(calls).finally(() => (globalThis.fetch = real));
}

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

test("mentions the assignee when their Chat user id is on file, any email case", () => {
  const text = buildMessage(created, { CHAT_USER_IDS: '{"Tania@zInspector.com": "1234"}' });
  assert.match(text, /Assigned to <users\/1234>/);
});

test("leaves out lines whose value is empty", () => {
  const text = buildMessage({ ...created, data: { ...created.data, description: "", referenceNumber: null } });
  assert.doesNotMatch(text, /Ref|>/);
  assert.doesNotMatch(text, /\n\n\n/);
});

test("adds a task link when TASK_URL is set", () => {
  const text = buildMessage(created, { TASK_URL: "https://zi.example/task/{id}" });
  assert.match(text, /<https:\/\/zi\.example\/task\/2160012\|Open in zInspector>$/);
});

test("an update to a completed status posts the celebration", () => {
  const done = { ...created, type: "task.updated", data: { ...created.data, status: { id: 9, value: "Completed" } } };
  assert.match(buildMessage(done), /^🎉 🎉 \*Task completed!\*/);
  const other = { ...done, data: { ...done.data, status: { id: 2, value: "In Progress" } } };
  assert.match(buildMessage(other), /^✏️ \*Task updated:\* Marketing Required/);
});

test("threads every message for one task together", () => {
  const url = new URL(threadUrl(CHAT, created));
  assert.equal(url.searchParams.get("threadKey"), "task-2160012");
  assert.equal(url.searchParams.get("key"), "K");
  assert.equal(url.searchParams.get("token"), "T");
});

test("relays a created task to the route's Chat space", () =>
  withChatStub(200, async (calls) => {
    const res = await worker.fetch(post("/marketing", created), ENV);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("https://chat.googleapis.com/v1/spaces/AAA/messages"));
    assert.match(calls[0].body.text, /We have a new task/);
  }));

test("rejects a wrong token and an unknown route without posting", () =>
  withChatStub(200, async (calls) => {
    assert.equal((await worker.fetch(post("/marketing", created, "wrong"), ENV)).status, 401);
    assert.equal((await worker.fetch(post("/sales", created), ENV)).status, 404);
    assert.equal(calls.length, 0);
  }));

test("reports a Google Chat failure back to zInspector", () =>
  withChatStub(400, async () => {
    const res = await worker.fetch(post("/marketing", created), ENV);
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "bad");
  }));

test("answers the Send test button with a connected message", () =>
  withChatStub(200, async (calls) => {
    await worker.fetch(post("/marketing", { type: "webhook.test" }), ENV);
    assert.equal(calls[0].body.text, "✅ zInspector is connected to this space.");
  }));
