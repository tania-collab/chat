// The admin page, served at "/". Plain HTML + JS, no build step.
// (The script below avoids backticks and dollar-brace so it can live in this template string.)

export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zInspector Chat Relay</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1d2430; --muted: #5d6676; --line: #dfe3ea;
    --accent: #1a73e8; --accent-text: #fff; --ok: #1e8e3e; --bad: #c5221f; --chip: #eef1f6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --card: #1b1f27; --text: #e7eaf0; --muted: #9aa3b2; --line: #2c323d;
      --accent: #8ab4f8; --accent-text: #0b1220; --ok: #81c995; --bad: #f28b82; --chip: #262c37;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 32px 0 12px; }
  p.lead { color: var(--muted); margin: 0 0 8px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .name { font-weight: 600; font-size: 16px; }
  .chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 1px 10px; font-size: 13px; color: var(--muted); }
  .chip.on { color: var(--text); }
  code.url { display: block; overflow-x: auto; white-space: nowrap; background: var(--chip); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  button, .btn { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--text);
                 border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  button.danger { color: var(--bad); }
  button:disabled { opacity: .6; cursor: default; }
  label { display: block; font-weight: 500; margin: 12px 0 4px; }
  .hint { color: var(--muted); font-size: 13px; font-weight: 400; }
  input[type=text], input[type=url], input[type=password], select {
    width: 100%; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .checks label { display: inline-flex; gap: 6px; align-items: center; font-weight: 400; margin: 4px 16px 0 0; }
  .msg { margin-top: 8px; font-size: 14px; }
  .msg.ok { color: var(--ok); } .msg.bad { color: var(--bad); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  td input { min-width: 120px; }
  .scroll { overflow-x: auto; }
  .empty { color: var(--muted); text-align: center; padding: 24px; }
  dialog { border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text);
           width: min(760px, calc(100vw - 32px)); padding: 20px; }
  textarea { width: 100%; min-height: 200px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
             background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; resize: vertical; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .split { grid-template-columns: 1fr; } }
  .preview { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line);
             border-radius: 8px; padding: 8px 10px; min-height: 200px; font-size: 14px; }
  .chatcard { border: 1px solid var(--line); border-radius: 12px; background: var(--card); overflow: hidden; }
  .cc-head { padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .cc-title { font-size: 15px; }
  .cc-body { padding: 10px 12px; display: grid; gap: 6px; justify-items: start; }
  .cc-quote { font-style: italic; }
  .cc-button { border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px; color: var(--accent); font-weight: 500; margin-top: 4px; }
  .fields { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .fields button { font: 12px ui-monospace, Menlo, monospace; padding: 2px 8px; border-radius: 999px; background: var(--chip); }
  dialog::backdrop { background: rgba(0,0,0,.4); }
  ol.steps { padding-left: 20px; margin: 0; } ol.steps li { margin-bottom: 6px; }
</style>
</head>
<body>
<main>
  <div class="row"><h1 class="grow">zInspector → Chat</h1><span class="hint" id="who"></span></div>
  <p class="lead">Each connection turns one zInspector webhook into messages in one chat. zInspector decides which events it sends; here you set the chat and the wording.</p>

  <div class="row" style="margin-top:24px">
    <h2 class="grow" style="margin:0">Connections</h2>
    <button class="primary" id="add">Add a chat</button>
  </div>
  <div id="connections" style="margin-top:12px"><div class="card empty">Loading…</div></div>

  <h2>Optional settings</h2>
  <p class="lead" style="margin-top:-6px">Messages work without these. Fill them in to add task links and real @mentions.</p>
  <form class="card" id="settings">
    <label for="taskUrl">Task link <span class="hint">the "Open in zInspector" link in task messages; {id} becomes each task's number.
      Only change it if zInspector's task pages move.</span></label>
    <input type="url" id="taskUrl">
    <label for="completedStatuses">"Done" statuses <span class="hint">a Task updated to one of these (comma-separated) posts the Task completed message</span></label>
    <input type="text" id="completedStatuses">
    <label>People <span class="hint">for @mentions that notify the assignee; without an id their name shows in bold.
      Google Chat user id: open contacts.google.com → Directory → click the person; it's the long number at the end of the address
      (contacts.google.com/person/<b>1022…</b>). Use <b>Paste a list</b> to add several at once.</span></label>
    <div class="scroll"><table>
      <thead><tr><th>zInspector email</th><th>Google Chat user id</th><th>Slack member id</th><th></th></tr></thead>
      <tbody id="people"></tbody>
    </table></div>
    <div class="row" style="margin-top:8px">
      <button type="button" id="addPerson">Add person</button>
      <button type="button" id="pastePeople">Paste a list</button>
      <span class="grow"></span>
      <button class="primary" type="submit">Save settings</button>
    </div>
    <div class="msg" id="settingsMsg"></div>
  </form>

  <h2>Connect zInspector</h2>
  <div class="card">
    <ol class="steps">
      <li>In your chat, create an incoming webhook. Google Chat: space name → Apps &amp; integrations → Webhooks. Slack: an app with Incoming Webhooks.</li>
      <li>Click <b>Add a chat</b> here and paste that webhook URL.</li>
      <li>In zInspector's <b>Edit Webhook</b>, paste the connection's <b>Destination URL</b>, use the same token, and pick the events and filters you want there.</li>
      <li>Press <b>Send test</b> in zInspector. "✅ zInspector is connected to this chat." should appear.</li>
      <li>Click <b>Edit messages</b> to change the wording of each event. After a real event arrives, its preview and field list use zInspector's own data.</li>
    </ol>
  </div>
</main>

<dialog id="dialog">
  <form id="form" method="dialog">
    <h2 id="formTitle" style="margin-top:0">Add a chat</h2>
    <label for="f-name">Name</label>
    <input type="text" id="f-name" placeholder="Marketing team" required>
    <label for="f-platform">Chat app</label>
    <select id="f-platform">
      <option value="google-chat">Google Chat</option>
      <option value="slack">Slack</option>
    </select>
    <label for="f-chatUrl">Chat webhook URL</label>
    <input type="url" id="f-chatUrl" required>
    <label for="f-token">zInspector webhook token <span class="hint">the token set on the zInspector webhook; alerts without it are refused</span></label>
    <input type="password" id="f-token" autocomplete="off">
    <label for="f-only">Post task alerts for <span class="hint">tasks that don't match are remembered but not posted</span></label>
    <select id="f-only"></select>
    <label>Post these alerts</label>
    <div class="checks" id="f-alerts"></div>
    <h2 style="margin:24px 0 4px">Messages</h2>
    <div class="hint">{{field}} puts in a value from the event. A line, or a part of a line between " · ", is left out when one of its fields is empty.
      Ready-made: {{taskTitle}} (the task's title, linked), {{taskType}}, {{assignee}} (@mentioned on new tasks, new assignments and completions),
      {{changes}} (what an update changed), {{dueDate}}, {{priorityFlag}} (only when not normal), {{shortDescription}},
      {{messageText}} and {{messageAuthor}}. Formatting: *bold*, _italic_, &lt;link|text&gt;.</div>
    <label for="f-event">Event</label>
    <select id="f-event"></select>
    <div class="hint" id="f-eventHint"></div>
    <div class="split" style="margin-top:8px">
      <div>
        <div class="row"><b class="grow">Message</b><button type="button" id="f-reset">Reset to default</button></div>
        <textarea id="f-template" spellcheck="false" style="margin-top:6px"></textarea>
      </div>
      <div>
        <div class="row"><b class="grow">Preview</b><span class="hint" id="f-source"></span></div>
        <div class="preview" id="f-preview" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="hint" style="margin-top:8px">Fields in this event (click to insert):</div>
    <div class="fields" id="f-fields"></div>
    <div class="msg bad" id="formMsg"></div>
    <div class="row" style="margin-top:16px; justify-content:flex-end">
      <button type="button" id="cancel">Cancel</button>
      <button class="primary" type="submit">Save</button>
    </div>
  </form>
</dialog>

<dialog id="bulk">
  <form id="bulkForm" method="dialog">
    <h2 style="margin-top:0">Paste a list of people</h2>
    <div class="hint">One person per line: their name (or email) and their Google Chat id or Contacts link, in any order,
      separated by spaces, commas or tabs. A name becomes name@<i>domain</i> below. People already in the list are updated.</div>
    <ol class="steps hint" style="margin:8px 0 0">
      <li>Open <b>contacts.google.com</b> → <b>Directory</b> and click a person.</li>
      <li>Copy the address from the browser bar: <code>https://contacts.google.com/person/1022…</code></li>
      <li>Add a line with their name and that address. Repeat for each person.</li>
    </ol>
    <label for="bulkText">List</label>
    <textarea id="bulkText" spellcheck="false" placeholder="andy https://contacts.google.com/person/105243888887804817324&#10;maria@zinspector.com, 112233445566778899001"></textarea>
    <div class="split" style="margin-top:4px">
      <div>
        <label for="bulkDomain">Email domain for names</label>
        <input type="text" id="bulkDomain" value="zinspector.com">
      </div>
      <div>
        <label for="bulkPlatform">These ids are for</label>
        <select id="bulkPlatform">
          <option value="google-chat">Google Chat</option>
          <option value="slack">Slack (member ids like U01ABCDEF)</option>
        </select>
      </div>
    </div>
    <div class="msg" id="bulkMsg"></div>
    <div class="row" style="margin-top:16px; justify-content:flex-end">
      <button type="button" id="bulkCancel">Cancel</button>
      <button class="primary" type="submit">Add to list and save</button>
    </div>
  </form>
</dialog>

<script>
var state = { connections: [], settings: {}, hookBase: "" };
var editing = null;
var PLATFORM = { "google-chat": "Google Chat", slack: "Slack" };
var PLACEHOLDER = {
  "google-chat": "https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...",
  slack: "https://hooks.slack.com/services/..."
};
var $ = function (id) { return document.getElementById(id); };

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === "text") node.textContent = attrs[k];
    else if (k === "on") Object.keys(attrs.on).forEach(function (ev) { node.addEventListener(ev, attrs.on[ev]); });
    else node.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { if (c) node.appendChild(c); });
  return node;
}

function call(method, path, body) {
  return fetch(path, {
    method: method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
      return data;
    });
  });
}

function load() {
  return call("GET", "/api/state").then(function (data) {
    state = data;
    $("who").textContent = data.user ? "Signed in as " + data.user : "";
    renderConnections();
    renderSettings();
  }).catch(function (err) {
    $("connections").replaceChildren(el("div", { "class": "card empty", text: err.message }));
  });
}

function renderConnections() {
  var box = $("connections");
  if (!state.connections.length) {
    box.replaceChildren(el("div", { "class": "card empty", text: "No chats yet. Click Add a chat to connect your first one." }));
    return;
  }
  box.replaceChildren.apply(box, state.connections.map(connectionCard));
}

function connectionCard(c) {
  var hookUrl = state.hookBase + c.id;
  var msg = el("div", { "class": "msg" });
  var logBox = el("div", { "class": "scroll", style: "display:none; margin-top:12px" });

  function flash(text, ok) { msg.className = "msg " + (ok ? "ok" : "bad"); msg.textContent = text; }

  return el("div", { "class": "card" }, [
    el("div", { "class": "row" }, [
      el("span", { "class": "name grow", text: c.name }),
      el("span", { "class": "chip on", text: PLATFORM[c.platform] || c.platform })
    ]),
    c.createdBy ? el("div", { "class": "hint", text: "Added by " + c.createdBy +
      (c.updatedBy && c.updatedBy !== c.createdBy ? " · last edited by " + c.updatedBy : "") }) : null,
    c.token ? null : el("div", { "class": "row", style: "margin-top:8px" }, [
      el("span", { "class": "chip", style: "color:var(--bad)", text: "No token: anyone with the address can post" })
    ]),
    el("label", { text: "Destination URL for zInspector", style: "margin-top:8px" }),
    el("div", { "class": "row" }, [
      el("code", { "class": "url grow", text: hookUrl }),
      el("button", { text: "Copy", on: { click: function () {
        navigator.clipboard.writeText(hookUrl).then(function () { flash("Copied.", true); },
          function () { flash("Copy failed: select the address and copy it.", false); });
      } } })
    ]),
    el("div", { "class": "row", style: "margin-top:12px" }, [
      el("button", { text: "Send test", on: { click: function (ev) {
        var b = ev.target; b.disabled = true; flash("Sending…", true);
        call("POST", "/api/connections/" + c.id + "/test").then(function (r) {
          flash(r.ok ? "Test message sent. Check the chat." : "The chat refused it (" + r.status + "): " + r.detail, r.ok);
        }).catch(function (err) { flash(err.message, false); }).then(function () { b.disabled = false; });
      } } }),
      el("button", { text: "Recent deliveries", on: { click: function () {
        if (logBox.style.display !== "none") { logBox.style.display = "none"; return; }
        logBox.style.display = "block";
        logBox.replaceChildren(el("div", { "class": "hint", text: "Loading…" }));
        call("GET", "/api/connections/" + c.id + "/log").then(function (log) { logBox.replaceChildren(logTable(log)); })
          .catch(function (err) { logBox.replaceChildren(el("div", { "class": "msg bad", text: err.message })); });
      } } }),
      el("span", { "class": "grow" }),
      el("button", { text: "Edit messages", on: { click: function () { openForm(c); } } }),
      el("button", { "class": "danger", text: "Delete", on: { click: function () {
        if (!confirm("Delete \"" + c.name + "\"? zInspector webhooks pointing at it will start failing.")) return;
        call("DELETE", "/api/connections/" + c.id).then(load).catch(function (err) { flash(err.message, false); });
      } } })
    ]),
    msg,
    logBox
  ]);
}

function logTable(log) {
  if (!log.length) return el("div", { "class": "hint", text: "Nothing delivered yet." });
  var label = { test: "Test" };
  (state.events || []).forEach(function (e) { label[e.key] = e.label; });
  return el("table", {}, [
    el("thead", {}, [el("tr", {}, ["When", "Event", "Ref", "Result"].map(function (h) { return el("th", { text: h }); }))]),
    el("tbody", {}, log.map(function (e) {
      return el("tr", {}, [
        el("td", { text: new Date(e.at).toLocaleString() }),
        el("td", { text: e.kind === "other" ? e.type : (label[e.kind] || e.kind) }),
        el("td", { text: e.ref ? "Ref " + e.ref : (e.taskId != null ? "#" + e.taskId : "") }),
        e.skipped
          ? el("td", { "class": "hint", text: "Not posted: " + ((state.skipReasons || {})[e.skipped] || "nothing visible changed") })
          : el("td", { style: "color:var(" + (e.ok ? "--ok" : "--bad") + ")",
                       text: e.ok ? "Delivered" : "Failed (" + e.status + ") " + (e.detail || "") })
      ]);
    }))
  ]);
}

function openForm(c) {
  editing = c || null;
  $("formTitle").textContent = c ? "Edit " + c.name : "Add a chat";
  $("f-name").value = c ? c.name : "";
  $("f-platform").value = c ? c.platform : "google-chat";
  $("f-chatUrl").value = c ? c.chatUrl : "";
  $("f-token").value = c ? c.token : "";
  $("f-only").replaceChildren.apply($("f-only"), Object.keys(state.audiences).map(function (k) {
    return el("option", { value: k, text: state.audiences[k] });
  }));
  $("f-only").value = c && state.audiences[c.only] ? c.only : "assigned";
  $("f-alerts").replaceChildren.apply($("f-alerts"), Object.keys(state.alerts).map(function (k) {
    var box = el("input", { type: "checkbox", "data-alert": k });
    box.checked = c && c.alerts ? !!c.alerts[k] : state.alerts[k].on;
    return el("label", {}, [box, document.createTextNode(" " + state.alerts[k].label)]);
  }));
  templates = {};
  state.events.forEach(function (e) { templates[e.key] = c && c.templates && c.templates[e.key] != null ? c.templates[e.key] : e.template; });
  $("f-event").replaceChildren.apply($("f-event"), state.events.map(function (e) { return el("option", { value: e.key, text: e.label }); }));
  $("formMsg").textContent = "";
  setPlaceholder();
  showEvent();
  $("dialog").showModal();
}

var templates = {};
var previewTimer = null;
var eventInfo = function () { var k = $("f-event").value; return state.events.filter(function (e) { return e.key === k; })[0]; };

function showEvent() {
  var e = eventInfo();
  $("f-eventHint").textContent = e.hint ? "Used when: " + e.hint + "." : "";
  $("f-template").value = templates[e.key];
  preview();
}

function preview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(function () {
    var key = $("f-event").value;
    call("POST", "/api/preview", { connectionId: editing ? editing.id : null, kind: key,
      template: $("f-template").value, platform: $("f-platform").value }).then(function (r) {
      if ($("f-event").value !== key) return;
      $("f-preview").innerHTML = r.card ? "" : (formatChat(r.text) || "<span class='hint'>(empty: nothing would be posted)</span>");
      if (r.card) $("f-preview").appendChild(cardPreview(r.text, r.card));
      $("f-source").textContent = r.source === "real" ? "last real event, " + new Date(r.at).toLocaleString() : "example data";
      $("f-fields").replaceChildren.apply($("f-fields"), r.fields.map(function (f) {
        return el("button", { type: "button", text: f, on: { click: function () { insertField(f); } } });
      }));
    }).catch(function (err) { $("f-preview").textContent = err.message; });
  }, 250);
}

function insertField(path) {
  var t = $("f-template"), at = t.selectionStart, token = "{{" + path + "}}";
  t.value = t.value.slice(0, at) + token + t.value.slice(t.selectionEnd);
  t.focus(); t.selectionStart = t.selectionEnd = at + token.length;
  templates[$("f-event").value] = t.value;
  preview();
}

// A look at the Google Chat card: heading, context line, the task, its description, the button.
function cardPreview(header, card) {
  return el("div", { "class": "chatcard" }, [
    el("div", { "class": "cc-head" }, [
      el("div", { "class": "cc-title", text: header }),
      card.subtitle ? el("div", { "class": "hint", text: card.subtitle }) : null
    ]),
    el("div", { "class": "cc-body" }, [
      el("b", { text: card.title }),
      card.description ? el("div", { "class": "cc-quote", text: "“" + card.description + "”" }) : null,
      card.link ? el("span", { "class": "cc-button", text: "Open the task" }) : null
    ])
  ]);
}

// A rough look at chat formatting: *bold*, _italic_, <url|text>. Escapes everything first.
function formatChat(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/&lt;(https?:\/\/[^|\s]+?)\|([^&]+?)&gt;/g, "<u>$2</u>")
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1<i>$2</i>");
}

function setPlaceholder() { $("f-chatUrl").placeholder = PLACEHOLDER[$("f-platform").value]; }

$("add").addEventListener("click", function () { openForm(null); });
$("cancel").addEventListener("click", function () { $("dialog").close(); });
$("f-platform").addEventListener("change", function () { setPlaceholder(); preview(); });
$("f-event").addEventListener("change", showEvent);
$("f-template").addEventListener("input", function () { templates[$("f-event").value] = $("f-template").value; preview(); });
$("f-reset").addEventListener("click", function () {
  var e = eventInfo(); templates[e.key] = e.template; showEvent();
});
$("form").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var body = {
    name: $("f-name").value, platform: $("f-platform").value, chatUrl: $("f-chatUrl").value, token: $("f-token").value,
    only: $("f-only").value, templates: templates,
    alerts: Object.fromEntries(Array.prototype.map.call($("f-alerts").querySelectorAll("input"), function (b) {
      return [b.getAttribute("data-alert"), b.checked];
    }))
  };
  var req = editing ? call("PUT", "/api/connections/" + editing.id, body) : call("POST", "/api/connections", body);
  req.then(function () { $("dialog").close(); return load(); })
     .catch(function (err) { $("formMsg").textContent = err.message; });
});

function renderSettings() {
  $("taskUrl").value = state.settings.taskUrl || "";
  $("completedStatuses").value = state.settings.completedStatuses || "";
  $("people").replaceChildren();
  (state.settings.people || []).forEach(addPersonRow);
}

function addPersonRow(p) {
  p = p || {};
  var input = function (cls, value, ph) { return el("input", { type: "text", "class": cls, value: value || "", placeholder: ph }); };
  var row = el("tr", {}, [
    el("td", {}, [input("p-email", p.email, "their zInspector email")]),
    el("td", {}, [input("p-gchat", p.googleChatId, "long number, if Google Chat")]),
    el("td", {}, [input("p-slack", p.slackId, "member id, if Slack")]),
    el("td", {}, [el("button", { type: "button", "class": "danger", text: "Remove", on: { click: function () { row.remove(); } } })])
  ]);
  $("people").appendChild(row);
}

$("addPerson").addEventListener("click", function () { addPersonRow(); });

// Bulk paste: each line holds a name or email and an id or Contacts link, in any order.
var ID_PATTERN = { "google-chat": /^(users\/)?\d{5,}$/, slack: /^[UW][A-Z0-9]{6,}$/ };
function parseList(text, platform, domain) {
  var found = [], skipped = 0;
  domain = domain.trim().replace(/^@/, "").toLowerCase();
  text.split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    var cells = line.split(/[\s,;]+/).map(function (c) { return c.replace(/^["'(<]+|["')>.:]+$/g, ""); }).filter(Boolean);
    var email = null, name = null, id = null;
    cells.forEach(function (c) {
      var link = c.match(/contacts\.google\.com\/(?:u\/\d+\/)?person\/(\d{5,})/);
      if (link) id = id || link[1];
      else if (ID_PATTERN[platform].test(c)) id = id || c.replace(/^users\//, "");
      else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) email = email || c;
      else if (/^[a-z][a-z0-9._-]*$/i.test(c) && !/^https?$/i.test(c)) name = name || c;
    });
    if (!email && name && domain) email = name + "@" + domain;
    if (email && id) found.push({ email: email.toLowerCase(), id: id });
    else skipped++;
  });
  return { found: found, skipped: skipped };
}

$("pastePeople").addEventListener("click", function () {
  $("bulkText").value = ""; $("bulkMsg").textContent = ""; $("bulk").showModal();
});
$("bulkCancel").addEventListener("click", function () { $("bulk").close(); });
$("bulkForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var platform = $("bulkPlatform").value;
  var result = parseList($("bulkText").value, platform, $("bulkDomain").value);
  if (!result.found.length) {
    $("bulkMsg").className = "msg bad";
    $("bulkMsg").textContent = "No lines with both a name or email and an id were found.";
    return;
  }
  var field = platform === "slack" ? ".p-slack" : ".p-gchat";
  var rows = {};
  Array.prototype.forEach.call($("people").children, function (row) {
    rows[row.querySelector(".p-email").value.trim().toLowerCase()] = row;
  });
  var added = 0, updated = 0;
  result.found.forEach(function (p) {
    if (!rows[p.email]) { addPersonRow({ email: p.email }); rows[p.email] = $("people").lastChild; added++; }
    else updated++;
    rows[p.email].querySelector(field).value = p.id;
  });
  $("bulk").close();
  $("settings").requestSubmit();
  $("settingsMsg").className = "msg ok";
  $("settingsMsg").textContent = "Added " + added + ", updated " + updated +
    (result.skipped ? ", skipped " + result.skipped + " line(s) without a name and id" : "") + ". Saving…";
});
$("settings").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var people = Array.prototype.map.call($("people").children, function (row) {
    return { email: row.querySelector(".p-email").value, googleChatId: row.querySelector(".p-gchat").value,
             slackId: row.querySelector(".p-slack").value };
  });
  var msg = $("settingsMsg");
  call("PUT", "/api/settings", { taskUrl: $("taskUrl").value, completedStatuses: $("completedStatuses").value, people: people })
    .then(function (s) { state.settings = s; renderSettings(); msg.className = "msg ok"; msg.textContent = "Saved."; })
    .catch(function (err) { msg.className = "msg bad"; msg.textContent = err.message; });
});

load();
</script>
</body>
</html>`;
