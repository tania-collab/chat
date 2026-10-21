import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { makeEnv, admin, hook, withChat, created, withStatus, ORIGIN, GCHAT_URL } from "./helpers.js";

const marketing = {
  name: "Marketing",
  platform: "google-chat",
  chatUrl: GCHAT_URL,
  token: "secret-1",
};

async function addConnection(env, body = marketing) {
  const res = await admin(env, "POST", "/api/connections", body);
  assert.equal(res.status, 201);
  return res.json();
}

test("the admin page and API need the password", async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(new Request(ORIGIN + "/"), env)).status, 401);
  assert.equal((await admin(env, "GET", "/api/state", null, { Authorization: "Basic " + btoa("me:wrong") })).status, 401);
  const page = await admin(env, "GET", "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /zInspector → Chat/);
});

test("changes from another site are refused", async () => {
  const res = await admin(makeEnv(), "POST", "/api/connections", marketing, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("a saved connection shows up with its zInspector address", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  const state = await (await admin(env, "GET", "/api/state")).json();
  assert.equal(state.connections[0].name, "Marketing");
  assert.equal(state.hookBase + c.id, `${ORIGIN}/hook/${c.id}`);
});

test("refuses a webhook URL that isn't the picked chat app's", async () => {
  const res = await admin(makeEnv(), "POST", "/api/connections", { ...marketing, chatUrl: "https://evil.example/x" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /chat\.googleapis\.com/);
});

test("relays a new task to the connection's chat and logs it", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    const res = await hook(env, c.id, created, "secret-1");
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("https://chat.googleapis.com/v1/spaces/AAA/messages"));
    assert.match(calls[0].body.text, /We have a new task/);
  });
  const log = await (await admin(env, "GET", `/api/connections/${c.id}/log`)).json();
  assert.deepEqual([log[0].kind, log[0].ref, log[0].ok], ["task.created", "313307", true]);
});

test("posts every event zInspector sends, each with its own message", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    await hook(env, c.id, withStatus("In Progress"), "secret-1");
    await hook(env, c.id, withStatus("Work Complete"), "secret-1");
    await hook(env, c.id, { type: "zdata.changed", data: { area: "Account", detail: "Notes", actionType: "Updated" } }, "secret-1");
    assert.deepEqual(
      calls.map((call) => call.body.text.split("\n")[0]),
      ["✏️ *Task updated:* Marketing Required", "🎉 🎉 *Task completed!* 🎉 🎉", "🗂️ *zData Updated:* Account › Notes"],
    );
  });
});

test("edited copy is saved and used for the next event", async () => {
  const env = makeEnv();
  const c = await addConnection(env, { ...marketing, templates: { "task.created": "Hi {{data.assignedTo}}" } });
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    assert.equal(calls[0].body.text, "Hi Tania Aquirre");
  });
});

test("preview uses example data first, then the last real event of that kind", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  const ask = async () =>
    (await admin(env, "POST", "/api/preview", { connectionId: c.id, kind: "task.message.created", template: "{{data.comment}}" })).json();
  assert.deepEqual([(await ask()).source, (await ask()).text], ["example", ""]);
  const real = { type: "task.message.created", data: { id: 1, comment: "On my way" } };
  await withChat(200, () => hook(env, c.id, real, "secret-1"));
  const after = await ask();
  assert.deepEqual([after.source, after.text], ["real", "On my way"]);
  assert.ok(after.fields.includes("data.comment"));
});

test("refuses a wrong token and an unknown connection without posting", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    assert.equal((await hook(env, c.id, created, "wrong")).status, 401);
    assert.equal((await hook(env, c.id, created)).status, 401);
    assert.equal((await hook(env, "nope", created, "secret-1")).status, 404);
    assert.equal(calls.length, 0);
  });
});

test("reports a chat failure back to zInspector and in the log", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(400, async () => {
    const res = await hook(env, c.id, created, "secret-1");
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "Invalid JSON payload");
  });
  const log = await (await admin(env, "GET", `/api/connections/${c.id}/log`)).json();
  assert.deepEqual([log[0].ok, log[0].status, log[0].detail], [false, 400, "Invalid JSON payload"]);
});

test("the page's Send test posts a connected message", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    const res = await (await admin(env, "POST", `/api/connections/${c.id}/test`)).json();
    assert.equal(res.ok, true);
    assert.equal(calls[0].body.text, "✅ zInspector is connected to this chat.");
  });
});

test("people saved in settings are @mentioned in relayed alerts", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  const saved = await admin(env, "PUT", "/api/settings", {
    completedStatuses: "",
    people: [{ email: " TANIA@zinspector.com ", googleChatId: "users/555" }, { email: "" }],
  });
  assert.deepEqual((await saved.json()).people, [{ email: "tania@zinspector.com", googleChatId: "555", slackId: "" }]);
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    assert.match(calls[0].body.text, /Assigned to <users\/555>/);
  });
});

test("editing keeps the address; deleting stops relaying", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  const edited = await (await admin(env, "PUT", `/api/connections/${c.id}`, { ...marketing, name: "Mktg" })).json();
  assert.deepEqual([edited.id, edited.name], [c.id, "Mktg"]);
  await admin(env, "DELETE", `/api/connections/${c.id}`);
  assert.equal((await hook(env, c.id, created, "secret-1")).status, 404);
});

test("links each message to its own task page without any setup", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    assert.match(calls[0].body.text, /<https:\/\/dashboard\.zinspector\.com\/task\/view\/2160012\|Open in zInspector>$/);
  });
});

test("Work Complete and Closed celebrate; Canceled and Deferred don't", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    for (const status of ["Work Complete", "Closed", "Canceled", "Deferred"]) {
      await hook(env, c.id, withStatus(status), "secret-1");
    }
    assert.deepEqual(
      calls.map((call) => call.body.text.includes("Task completed")),
      [true, true, false, false],
    );
  });
});

test("settings saved with the old defaults move to zInspector's statuses and task link", async () => {
  const env = makeEnv();
  await env.RELAY.put("settings", JSON.stringify({ taskUrl: "", completedStatuses: "Completed,Closed", people: [] }));
  const { settings } = await (await admin(env, "GET", "/api/state")).json();
  assert.equal(settings.completedStatuses, "Work Complete,Closed");
  assert.equal(settings.taskUrl, "https://dashboard.zinspector.com/task/view/{id}");
});
