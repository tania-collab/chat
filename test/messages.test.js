import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, buildPayload, render, eventKind, deliveryUrl, fieldPaths, defaultTemplates, DEFAULT_TASK_URL } from "../src/messages.js";
import { snapshotOf } from "../src/taskview.js";
import { created, withStatus, GCHAT_URL } from "./helpers.js";
import { localDate } from "../src/time.js";

// A date N days from today (Pacific), so date wording is tested the same way any day.
const inDays = (n) => new Date(Date.parse(localDate()) + n * 86400000).toISOString().slice(0, 10);

const ALL_ALERTS = { created: true, assigned: true, completed: true, changes: true, messages: true };
const gchat = { platform: "google-chat", chatUrl: GCHAT_URL, templates: defaultTemplates(), alerts: ALL_ALERTS };
const withLink = { taskUrl: DEFAULT_TASK_URL };
const block = (payload) => payload.cardsV2[0].card.sections[0].widgets[0].decoratedText;
// The card's clock row (due date and priority, or how a finished task ended), without its color tags.
const detailsOf = (payload) => {
  const row = payload.cardsV2[0].card.sections[0].widgets.find((w) => w.decoratedText?.startIcon?.knownIcon === "CLOCK");
  return row.decoratedText.text.replace(/<\/?font[^>]*>/g, "");
};
const update = (data) => ({ ...created, type: "task.updated", data: { ...created.data, ...data } });

test("a new task is a sentence about the person, then one compact block with the task and an Open button", () => {
  const event = { ...created, data: { ...created.data, endDate: inDays(2), priority: 4, manager: { name: "Laura E." }, description: "Book the booth\nand send the attendee list" } };
  const payload = buildPayload(event, gchat, withLink);
  assert.equal(payload.text, "📌 *Tania Aquirre*, you've got a new task from Laura");
  assert.deepEqual(payload.cardsV2[0].card, {
    sections: [{ widgets: [
      { decoratedText: {
        text: "<b>Book the booth</b>", wrapText: true, startIcon: { knownIcon: "DESCRIPTION" }, topLabel: "Conferences",
        button: { text: "Open", onClick: { openLink: { url: "https://dashboard.zinspector.com/task/view/2160012" } } },
      } },
      { decoratedText: { startIcon: { knownIcon: "CLOCK" }, text: 'Due in 2 days · <font color="#e8710a">High priority</font>', wrapText: true } },
      { textParagraph: { text: "<i>“Book the booth and send the attendee list”</i>" } },
    ] }],
  });
});

test("Slack gets the same message as text", () => {
  const payload = buildPayload(created, { ...gchat, platform: "slack" }, withLink);
  assert.equal(payload.cardsV2, undefined);
  assert.equal(payload.text, "📌 *Tania Aquirre*, you've got a new task\n*<https://dashboard.zinspector.com/task/view/2160012|test task>*\nConferences · No due date yet · Normal priority");
});

test("a new task with nobody on it (for chats that get all tasks) still reads well, and nudges for a due date", () => {
  const payload = buildPayload({ ...created, data: { ...created.data, assignedTo: null, manager: { name: "Laura E." } } }, { ...gchat, only: "all" });
  assert.equal(payload.text, "📌 New task from Laura");
  assert.equal(detailsOf(payload), "No due date yet · Normal priority");
});

test("names a vendor when the task is assigned to a contact", () => {
  const event = { ...created, data: { ...created.data, assignedTo: null, assignedToContact: { name: "Acme Painting" } } };
  assert.equal(buildMessage(event, gchat), "📌 *Acme Painting*, you've got a new task");
});

test("an update lists only what changed", () => {
  const before = snapshotOf(created.data);
  const event = update({
    status: { id: 2, value: "In Progress" },
    endDate: "2026-11-02",
    priority: 5,
  });
  const settings = { people: [{ email: "tim@zinspector.com", googleChatId: "110410588780324983531" }] };
  assert.equal(
    buildMessage(event, gchat, settings, before),
    [
      "✏️ *test task*",
      "• Status: New → *In Progress*",
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
    "💬 *New message* · *test task*\n> If this shows up as a task, we're ready.\n— Greg Owen",
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
  assert.equal(buildPayload(tagged, gchat, settings).text, "📌 <users/1234>, you've got a new task");
  assert.match(buildPayload(tagged, { ...gchat, platform: "slack" }, settings).text, /^📌 <@U99>, you've got a new task\n/);
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

test("a long title is cut on the card, the full description is quoted, and link-breaking characters are dropped", () => {
  const description = "Sponsor Opportunities! 2027 CALNARPM Conference <Anchored in Excellence> | booth, panel and dinner options for next year";
  const event = { ...created, data: { ...created.data, description } };
  const { widgets } = buildPayload(event, gchat, withLink).cardsV2[0].card.sections[0];
  const bold = widgets[0].decoratedText.text;
  assert.ok(bold.endsWith("…</b>") && !bold.includes("<Anchored"), bold);
  assert.equal(widgets[2].textParagraph.text, `<i>“${description.replace("<", "&lt;").replace(">", "&gt;")}”</i>`);
  const update = { ...event, type: "task.updated", data: { ...event.data, status: { value: "In Progress" } } };
  const label = buildMessage(update, gchat, withLink, snapshotOf(event.data)).match(/\|(.+)>/)[1];
  assert.ok(!/[<>|]/.test(label), label);
});

test("a finished task's card says how it ended", () => {
  const before = snapshotOf({ ...created.data, status: { value: "In Progress" } });
  const payload = buildPayload(withStatus("Work Complete"), gchat, {}, before);
  const settings = { people: [{ email: "tania@zinspector.com", googleChatId: "1234" }] };
  assert.equal(buildPayload(withStatus("Work Complete"), gchat, settings, before).text, "🎉 Tania wrapped up *test task*"); // no ping
  assert.equal(detailsOf(payload), "✓ Done");
});

test("a task given to someone is a newly assigned alert", () => {
  const event = update({ assignedTo: { name: "Tim Wallace" }, manager: { name: "Laura E." } });
  assert.equal(eventKind(event, {}, snapshotOf(created.data)), "task.assigned");
  assert.equal(buildPayload(event, gchat, {}, snapshotOf(created.data)).text, "👋 *Tim Wallace*, *test task* is yours now");
  assert.equal(block(buildPayload(event, gchat, {}, snapshotOf(created.data))).startIcon.knownIcon, "PERSON");
});

test("says when a task is due in words, and flags overdue ones", () => {
  const payloadDue = (n, priority = 3) => buildPayload({ ...created, data: { ...created.data, priority, endDate: n === null ? null : inDays(n) } }, gchat);
  const due = (n) => detailsOf(payloadDue(n)).replace(" · Normal priority", "");
  assert.equal(due(0), "Due today");
  assert.equal(due(1), "Due tomorrow");
  assert.equal(due(5), "Due in 5 days");
  assert.equal(due(-1), "Overdue by 1 day");
  assert.equal(due(-3), "Overdue by 3 days");
  assert.match(due(10), /^Due [A-Z][a-z]{2} \d+/);
  assert.equal(due(null), "No due date yet");
  // Colors carry the urgency: red overdue and highest priority, amber soon, orange high, grey not set.
  const html = (n, p) => payloadDue(n, p).cardsV2[0].card.sections[0].widgets[1].decoratedText.text;
  assert.equal(html(-1, 5), '<font color="#d93025">Overdue by 1 day</font> · <font color="#d93025">Highest priority</font>');
  assert.equal(html(1, 4), '<font color="#e37400">Due tomorrow</font> · <font color="#e8710a">High priority</font>');
  assert.equal(html(null, 3), '<font color="#5f6368">No due date yet</font> · <font color="#5f6368">Normal priority</font>');
});

test("a finished task cheers when it's early or on time, and says when it's late", () => {
  const done = (n, status = "Work Complete") => {
    const data = { ...created.data, endDate: inDays(n) };
    const before = snapshotOf({ ...data, status: { value: "In Progress" } });
    const payload = buildPayload({ ...created, type: "task.updated", data: { ...data, status: { value: status } } }, gchat, {}, before);
    return [payload.text, detailsOf(payload)];
  };
  assert.deepEqual(done(2), ["🎉 Tania wrapped up *test task* — 2 days early 🚀", "✓ Done · 2 days early"]);
  assert.deepEqual(done(0), ["🎉 Tania wrapped up *test task* — right on time ✅", "✓ Done · on time"]);
  assert.deepEqual(done(-1, "Closed"), ["🎉 Tania wrapped up *test task* — 1 day late", "✓ Closed · 1 day late"]);
});

test("an optional detail disappears when empty, without taking its line with it", () => {
  assert.equal(render("Hi{{data.who?}}!", { type: "x", data: {} }), "Hi!");
  assert.equal(render("Hi {{data.who?}}!", { type: "x", data: { who: "Tim" } }), "Hi Tim!");
});

test("doesn't say who a task is from when they gave it to themselves", () => {
  const self = { ...created, data: { ...created.data, manager: { name: "Tania Aquirre", email: "tania+onsight@zinspector.com" } } };
  assert.equal(buildMessage(self, gchat), "📌 *Tania Aquirre*, you've got a new task");
});
