import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { makeEnv, admin, hook, withChat, created, withStatus, ORIGIN, GCHAT_URL } from "./helpers.js";

const marketing = {
  name: "Marketing",
  platform: "google-chat",
  chatUrl: GCHAT_URL,
  token: "secret-1",
  // Most tests check message content, so this chat posts every kind of alert.
  alerts: { created: true, assigned: true, completed: true, changes: true, messages: true },
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
    assert.equal(calls[0].body.cardsV2[0].card.header.title, "Tania has a new task");
  });
  const log = await (await admin(env, "GET", `/api/connections/${c.id}/log`)).json();
  assert.deepEqual([log[0].kind, log[0].ref, log[0].ok], ["task.created", "313307", true]);
});

test("posts each update with only what changed, and skips updates that changed nothing", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    const unchanged = await hook(env, c.id, { ...created, type: "task.updated" }, "secret-1");
    assert.equal(await unchanged.text(), "Not posted: nothing visible changed.");
    await hook(env, c.id, withStatus("In Progress"), "secret-1");
    await hook(env, c.id, withStatus("Work Complete"), "secret-1");
    await hook(env, c.id, { type: "zdata.changed", data: { area: "Account", detail: "Notes", actionType: "Updated" } }, "secret-1");
    assert.equal(calls.length, 4);
    assert.match(calls[1].body.text, /• Status: New → \*In Progress\*$/);
    assert.equal(calls[2].body.cardsV2[0].card.header.title, "Tania finished a task ✅");
    assert.match(calls[3].body.text, /^🗂️ \*Account › Notes\* Updated/);
  });
  const log = await (await admin(env, "GET", `/api/connections/${c.id}/log`)).json();
  assert.equal(log.find((e) => e.skipped).kind, "task.updated");
});

test("celebrates a completion once, not on every later edit of a done task", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    await hook(env, c.id, withStatus("Work Complete"), "secret-1");
    await hook(env, c.id, { ...withStatus("Work Complete"), data: { ...withStatus("Work Complete").data, priority: 5 } }, "secret-1");
    await hook(env, c.id, withStatus("Closed"), "secret-1");
    assert.equal(calls.filter((call) => call.body.cardsV2?.[0].card.header.title?.endsWith("✅")).length, 1);
    assert.match(calls[2].body.text, /Priority: Normal → \*Highest\*/);
    assert.match(calls[3].body.text, /Status: Work Complete → \*Closed\*/);
  });
});

test("a bulk clean-up of tasks the chat never saw posts nothing", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  await withChat(200, async (calls) => {
    for (let id = 1; id <= 30; id++) {
      const res = await hook(env, c.id, { ...withStatus("Work Complete"), data: { ...withStatus("Work Complete").data, id } }, "secret-1");
      assert.equal(await res.text(), "Not posted: first time this task was seen, so there's nothing to compare.");
    }
    assert.equal(calls.length, 0);
  });
});

test("edited copy is saved and used for the next event", async () => {
  const env = makeEnv();
  const c = await addConnection(env, { ...marketing, templates: { "task.created": "Hi {{data.assignedTo}}" } });
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    assert.equal(calls[0].body.cardsV2[0].card.header.title, "Hi Tania Aquirre");
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

test("people saved in settings are @mentioned on a new task, not on every update", async () => {
  const env = makeEnv();
  const c = await addConnection(env);
  const saved = await admin(env, "PUT", "/api/settings", {
    completedStatuses: "",
    people: [{ email: " TANIA@zinspector.com ", googleChatId: "users/555" }, { email: "" }],
  });
  assert.deepEqual((await saved.json()).people, [{ email: "tania@zinspector.com", googleChatId: "555", slackId: "" }]);
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    await hook(env, c.id, withStatus("In Progress"), "secret-1");
    assert.equal(calls[0].body.text, "<users/555>");
    assert.doesNotMatch(calls[1].body.text, /users\/555/);
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
    const button = calls[0].body.cardsV2[0].card.sections.at(-1).widgets.at(-1).buttonList.buttons[0];
    assert.equal(button.onClick.openLink.url, "https://dashboard.zinspector.com/task/view/2160012");
  });
});

test("Work Complete and Closed celebrate; Canceled and Deferred don't", async () => {
  for (const [status, celebrates] of [["Work Complete", true], ["Closed", true], ["Canceled", false], ["Deferred", false]]) {
    const env = makeEnv();
    const c = await addConnection(env);
    await withChat(200, async (calls) => {
      await hook(env, c.id, created, "secret-1");
      await hook(env, c.id, withStatus(status), "secret-1");
      assert.equal(Boolean(calls[1].body.cardsV2?.[0].card.header.title.endsWith("✅")), celebrates, status);
    });
  }
});

test("posts only tasks with someone assigned (or a next to-do), as the chat's rule says", async () => {
  const unassigned = { ...created, data: { ...created.data, id: 11, assignedTo: null, nextToDo: null } };
  const nextOnly = { ...created, data: { ...created.data, id: 12, assignedTo: null, nextToDo: { id: 1, name: "Laura E." } } };
  const posted = async (only) => {
    const env = makeEnv();
    const c = await addConnection(env, { ...marketing, only });
    return withChat(200, async (calls) => {
      for (const e of [created, unassigned, nextOnly]) await hook(env, c.id, e, "secret-1");
      return calls.length;
    });
  };
  assert.equal(await posted(undefined), 1); // default: someone assigned
  assert.equal(await posted("assigned-or-next"), 2);
  assert.equal(await posted("all"), 3);
});

test("tells the chat when someone is taken off a task it followed", async () => {
  const env = makeEnv();
  const c = await addConnection(env, { ...marketing, only: "assigned" });
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    await hook(env, c.id, { ...created, type: "task.updated", data: { ...created.data, assignedTo: null } }, "secret-1");
    await hook(env, c.id, { ...created, type: "task.updated", data: { ...created.data, assignedTo: null, priority: 5 } }, "secret-1");
    assert.equal(calls.length, 2);
    assert.match(calls[1].body.text, /Unassigned \(was Tania Aquirre\)/);
  });
});

test("messages saved with the old default copy move to the new one; edited ones stay", async () => {
  const env = makeEnv();
  const { LEGACY_TEMPLATES } = await import("../src/legacy.js");
  const c = await addConnection(env, {
    ...marketing,
    templates: { "task.created": LEGACY_TEMPLATES["task.created"][0], "task.updated": "Mine: {{data.status}}" },
  });
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1");
    await hook(env, c.id, withStatus("In Progress"), "secret-1");
    assert.equal(calls[0].body.cardsV2[0].card.header.title, "Tania has a new task");
    assert.equal(calls[1].body.text, "Mine: In Progress");
  });
  const state = await (await admin(env, "GET", "/api/state")).json();
  assert.equal(state.connections[0].templates["task.created"], "{{assigneeFirstName}} has a new task");
});

test("settings saved with the old defaults move to zInspector's statuses and task link", async () => {
  const env = makeEnv();
  await env.RELAY.put("settings", JSON.stringify({ taskUrl: "", completedStatuses: "Completed,Closed", people: [] }));
  const { settings } = await (await admin(env, "GET", "/api/state")).json();
  assert.equal(settings.completedStatuses, "Work Complete,Closed");
  assert.equal(settings.taskUrl, "https://dashboard.zinspector.com/task/view/{id}");
});

test("a pasted list can't create the same person twice", async () => {
  const env = makeEnv();
  const res = await admin(env, "PUT", "/api/settings", {
    people: [{ email: "Maria@zinspector.com", googleChatId: "111111" }, { email: "maria@zinspector.com", googleChatId: "222222" }],
  });
  assert.deepEqual((await res.json()).people, [{ email: "maria@zinspector.com", googleChatId: "222222", slackId: "" }]);
});

test("by default a chat gets new, newly assigned and finished tasks, not other changes or messages", async () => {
  const env = makeEnv();
  const { alerts, ...plain } = marketing;
  const c = await addConnection(env, plain);
  const unassigned = { ...created, data: { ...created.data, id: 21, assignedTo: null } };
  await withChat(200, async (calls) => {
    await hook(env, c.id, created, "secret-1"); // new, assigned: posted
    await hook(env, c.id, withStatus("In Progress"), "secret-1"); // status change: tracked, not posted
    await hook(env, c.id, { type: "task.message.created", data: { ...created.data, message: "hi" } }, "secret-1"); // message: off
    await hook(env, c.id, withStatus("Work Complete"), "secret-1"); // finished: posted
    await hook(env, c.id, unassigned, "secret-1"); // new but nobody assigned: not posted
    await hook(env, c.id, { ...unassigned, type: "task.updated", data: { ...unassigned.data, assignedTo: { name: "Tim Wallace" } } }, "secret-1"); // newly assigned: posted
    assert.deepEqual(
      calls.map((call) => call.body.cardsV2[0].card.header.title),
      ["Tania has a new task", "Tania finished a task ✅", "Tim was assigned a task"],
    );
  });
  const log = await (await admin(env, "GET", `/api/connections/${c.id}/log`)).json();
  assert.equal(log.filter((e) => e.skipped === "alert-off").length, 2);
});
