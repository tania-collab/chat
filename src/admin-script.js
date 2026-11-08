// The admin page's script (served inside ADMIN_HTML). Plain JS, no build step.
// (It avoids backticks and dollar-brace so it can live in this template string.)

export const ADMIN_SCRIPT = String.raw`
var state = { connections: [], settings: {}, hookBase: "" };
var editing = null;
var PLATFORM = { "google-chat": "Google Chat", slack: "Slack" };
var CHAT_LINK = {
  "google-chat": { label: "Google Chat link", placeholder: "https://chat.googleapis.com/v1/spaces/...",
    how: "In Google Chat, open the space → its name at the top → Apps & integrations → Webhooks → Add webhook, then copy the link." },
  slack: { label: "Slack webhook link", placeholder: "https://hooks.slack.com/services/...",
    how: "In Slack, create an app with Incoming Webhooks turned on, add one for the channel, then copy its link." }
};
var KIND_LABEL = {
  test: "Test message", digest: "Summary", "task.created": "New task", "task.assigned": "Newly assigned",
  "task.updated": "Update", "task.completed": "Finished", "task.message.created": "New message",
  "report.distributed": "Report sent", "zdata.changed": "zData change"
};
// Message details as people say them; stored as {{codes}} the server understands.
var DETAILS = [
  ["Person", "assignee"], ["First name", "assigneeFirstName"], ["from Manager", "fromManager?"], ["Task title", "shortTitle"],
  ["early / late", "finishTiming?"], ["From", "managerName"], ["Task title, linked", "taskTitle"],
  ["Area", "area"], ["Due date", "dueDate"], ["Priority", "priorityFlag"], ["Status", "data.status"],
  ["What changed", "changes"], ["Description", "descriptionMore"], ["Message", "messageText"],
  ["Message author", "messageAuthor"], ["Type", "taskType"], ["Property", "data.propertyName"],
  ["Ref", "data.referenceNumber"], ["Event name", "type"]
];
var $ = function (id) { return document.getElementById(id); };
var pollTimer = null;

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
      if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ")");
      return data;
    });
  });
}

// Optional details ({{name?}}) bring their own leading space when they have a value, so the box shows one too.
function toFriendly(template) {
  return DETAILS.reduce(function (t, d) {
    var optional = d[1].slice(-1) === "?";
    return t.split("{{" + d[1] + "}}").join((optional ? " " : "") + "[" + d[0] + "]");
  }, template || "");
}
function fromFriendly(text) {
  return DETAILS.reduce(function (t, d) {
    var optional = d[1].slice(-1) === "?";
    if (optional) t = t.split(" [" + d[0] + "]").join("{{" + d[1] + "}}");
    return t.split("[" + d[0] + "]").join("{{" + d[1] + "}}");
  }, text || "");
}

// "just now", "5 minutes ago", "2 hours ago", "3 days ago".
function ago(iso) {
  var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  var unit = function (n, w) { n = Math.floor(n); return n + " " + w + (n === 1 ? "" : "s") + " ago"; };
  if (s < 60) return "just now";
  if (s < 3600) return unit(s / 60, "minute");
  if (s < 86400) return unit(s / 3600, "hour");
  return unit(s / 86400, "day");
}

function load(quiet) {
  return call("GET", "/api/state").then(function (data) {
    var changed = JSON.stringify(data.connections) !== JSON.stringify(state.connections);
    state = data;
    $("who").textContent = data.user ? "Signed in as " + data.user : "";
    if (!quiet || changed) renderConnections();
    if (!quiet) renderSettings();
    // Keep each chat's health current: every few seconds while a chat waits for zInspector's first test
    // (so its setup ticks itself off), every minute otherwise.
    clearTimeout(pollTimer);
    var waiting = state.connections.some(function (c) { return !c.health.zinspectorReached; });
    pollTimer = setTimeout(function () { load(true); }, waiting ? 5000 : 60000);
  }).catch(function (err) {
    if (!quiet) $("connections").replaceChildren(el("div", { "class": "card empty", text: err.message }));
  });
}

function renderConnections() {
  var box = $("connections");
  if (!state.connections.length) {
    box.replaceChildren(el("div", { "class": "card empty" }, [
      el("div", { text: "No chats yet." }),
      el("div", { "class": "hint", text: "Add one to start getting zInspector tasks in Google Chat or Slack." })
    ]));
    return;
  }
  box.replaceChildren.apply(box, state.connections.map(connectionCard));
}

function copyButton(value, flash) {
  return el("button", { type: "button", text: "Copy", on: { click: function () {
    navigator.clipboard.writeText(value).then(function () { flash("Copied.", true); },
      function () { flash("Couldn't copy: select the link and copy it.", false); });
  } } });
}

function connectionCard(c) {
  var link = state.hookBase + c.id;
  var msg = el("div", { "class": "msg" });
  var history = el("div", { "class": "scroll", style: "display:none; margin-top:12px" });
  var h = c.health;
  function flash(text, ok) { msg.className = "msg " + (ok ? "ok" : "bad"); msg.textContent = text; }

  function sendTest(ev) {
    var b = ev.target; b.disabled = true; flash("Sending…", true);
    call("POST", "/api/connections/" + c.id + "/test").then(function (r) {
      flash(r.ok ? "Sent. Check the chat." : PLATFORM[c.platform] + " didn't accept it (" + r.status + "): " + r.detail, r.ok);
      return load(true);
    }).catch(function (err) { flash(err.message, false); }).then(function () { b.disabled = false; });
  }

  var body = h.zinspectorReached ? [
    healthLine(h),
    el("label", { text: "Link for zInspector", style: "margin-top:12px" }),
    el("div", { "class": "row" }, [el("code", { "class": "url grow", text: link }), copyButton(link, flash)])
  ] : [setupSteps(c, h, link, flash, sendTest)];

  return el("div", { "class": "card" }, [
    el("div", { "class": "row" }, [
      el("span", { "class": "name grow", text: c.name }),
      el("span", { "class": "chip on", text: PLATFORM[c.platform] || c.platform })
    ]),
    c.createdBy ? el("div", { "class": "hint", text: "Added by " + c.createdBy +
      (c.updatedBy && c.updatedBy !== c.createdBy ? " · last changed by " + c.updatedBy : "") }) : null,
    c.token ? null : el("div", { "class": "row", style: "margin-top:8px" }, [
      el("span", { "class": "chip", style: "color:var(--bad)", text: "No security code: anyone with the link could post here" })
    ])
  ].concat(body, [
    el("div", { "class": "row", style: "margin-top:12px" }, [
      h.zinspectorReached ? el("button", { text: "Send a test message", on: { click: sendTest } }) : null,
      el("button", { text: "Send the summary now", on: { click: function (ev) {
        var b = ev.target; b.disabled = true; flash("Sending…", true);
        call("POST", "/api/connections/" + c.id + "/digest").then(function (r) {
          if (r.empty) flash("Nothing to list: no open tasks match this chat's summary settings.", true);
          else flash(r.ok ? "Summary sent. Check the chat." : "Not sent (" + r.status + "): " + r.detail, r.ok);
        }).catch(function (err) { flash(err.message, false); }).then(function () { b.disabled = false; });
      } } }),
      el("button", { text: "History", on: { click: function () {
        if (history.style.display !== "none") { history.style.display = "none"; return; }
        history.style.display = "block";
        history.replaceChildren(el("div", { "class": "hint", text: "Loading…" }));
        call("GET", "/api/connections/" + c.id + "/log").then(function (log) { history.replaceChildren(historyTable(log)); })
          .catch(function (err) { history.replaceChildren(el("div", { "class": "msg bad", text: err.message })); });
      } } }),
      el("span", { "class": "grow" }),
      el("button", { text: "Settings", on: { click: function () { openForm(c); } } }),
      el("button", { "class": "danger", text: "Delete", on: { click: function () {
        if (!confirm("Delete \"" + c.name + "\"? zInspector will get errors until you remove its webhook too.")) return;
        call("DELETE", "/api/connections/" + c.id).then(function () { return load(); }).catch(function (err) { flash(err.message, false); });
      } } })
    ]),
    msg,
    history
  ]));
}

// "✓ Last message 2 hours ago · New task: webchatTEST", or what went wrong.
function healthLine(h) {
  if (!h.last) return el("div", { "class": "health ok", text: "✓ Connected · waiting for the first alert" });
  var what = (KIND_LABEL[h.last.kind] || "Message") + (h.last.title ? ": " + h.last.title : "");
  if (h.last.ok) return el("div", { "class": "health ok", text: "✓ Last message " + ago(h.last.at) + " · " + what });
  return el("div", { "class": "health bad", text: "⚠ The last message failed " + ago(h.last.at) + " (" + what + "): " +
    (h.last.detail || "error " + h.last.status) + ". Open History for details." });
}

// Guided setup until zInspector's first event arrives; each step ticks itself off.
function setupSteps(c, h, link, flash, sendTest) {
  function step(done, title, children) {
    return el("li", { "class": done ? "done" : "" }, [el("b", { text: (done ? "✓ " : "") + title })].concat(children || []));
  }
  return el("ol", { "class": "setup" }, [
    step(h.chatReached, PLATFORM[c.platform] + " is connected", h.chatReached ? [] : [
      el("div", { "class": "hint", text: "Send a test message to check that it reaches the chat." }),
      el("button", { type: "button", text: "Send a test message", style: "margin-top:6px", on: { click: sendTest } })
    ]),
    step(false, "Paste this link in zInspector", [
      el("div", { "class": "hint", text: "zInspector → Configuration → Webhooks → Edit Webhook → Destination URL. " +
        (c.token ? "Use the same security code. " : "") + "Choose the events (Task created, Task updated) and any filters there." }),
      el("div", { "class": "row", style: "margin-top:6px" }, [el("code", { "class": "url grow", text: link }), copyButton(link, flash)])
    ]),
    step(false, "Press Send test in zInspector", [
      el("div", { "class": "hint", text: "This page checks every few seconds and ticks this off when the test arrives." })
    ])
  ]);
}

function historyTable(log) {
  if (!log.length) return el("div", { "class": "hint", text: "Nothing yet." });
  return el("table", {}, [
    el("thead", {}, [el("tr", {}, ["When", "What", "Result"].map(function (t) { return el("th", { text: t }); }))]),
    el("tbody", {}, log.map(function (e) {
      var what = [KIND_LABEL[e.kind] || e.type, e.title, e.person].filter(Boolean).join(" · ");
      var result = e.skipped
        ? el("td", { "class": "hint", text: "Not posted: " + ((state.skipReasons || {})[e.skipped] || "nothing visible changed") })
        : el("td", { style: "color:var(" + (e.ok ? "--ok" : "--bad") + ")",
                     text: e.ok ? "Posted" : "Failed: the chat said " + (e.detail || "error " + e.status) });
      return el("tr", {}, [el("td", { title: new Date(e.at).toLocaleString(), text: ago(e.at) }), el("td", { text: what }), result]);
    }))
  ]);
}

function openForm(c) {
  editing = c || null;
  $("formTitle").textContent = c ? "Settings for " + c.name : "Add a chat";
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
  var s = c && c.summary ? c.summary : { schedule: "weekly", days: 7, onlyProperties: false, properties: [], onlyDated: true, includeOverdue: true, onlyAssigned: true };
  $("f-schedule").replaceChildren.apply($("f-schedule"), Object.keys(state.schedules).map(function (k) {
    return el("option", { value: k, text: state.schedules[k] });
  }));
  $("f-schedule").value = s.schedule;
  $("f-days").replaceChildren.apply($("f-days"), state.summaryDays.map(function (d) {
    return el("option", { value: String(d), text: d === 1 ? "tomorrow" : "the next " + d + " days" });
  }));
  $("f-days").value = String(s.days);
  $("f-onlyProperties").checked = !!s.onlyProperties;
  $("f-properties").value = (s.properties || []).map(function (p) { return p.label; }).join("\n");
  chosen = (s.properties || []).map(function (p) { return { label: p.label, name: p.name, ids: (p.ids || []).slice() }; });
  $("f-propSearch").value = "";
  $("f-propResults").replaceChildren();
  $("f-propMsg").textContent = "";
  renderChosen();
  $("f-onlyDated").checked = !!s.onlyDated;
  $("f-includeOverdue").checked = !!s.includeOverdue;
  $("f-overdueWithin").replaceChildren.apply($("f-overdueWithin"), state.overdueWithin.map(function (d) {
    return el("option", { value: String(d), text: d ? d + " days" : "any time (all)" });
  }));
  $("f-overdueWithin").value = String(s.overdueWithin == null ? 30 : s.overdueWithin);
  $("f-onlyAssigned").checked = !!s.onlyAssigned;
  showSummary();
  templates = {};
  state.events.forEach(function (e) { templates[e.key] = c && c.templates && c.templates[e.key] != null ? c.templates[e.key] : e.template; });
  $("f-event").replaceChildren.apply($("f-event"), state.events.map(function (e) { return el("option", { value: e.key, text: e.label }); }));
  $("f-details").replaceChildren.apply($("f-details"), DETAILS.slice(0, 14).map(function (d) {
    return el("button", { type: "button", text: d[0], on: { click: function () { insertText("[" + d[0] + "]"); } } });
  }));
  $("formMsg").textContent = "";
  setPlatform();
  showEvent();
  $("dialog").showModal();
}

var templates = {};
var previewTimer = null;
var eventInfo = function () { var k = $("f-event").value; return state.events.filter(function (e) { return e.key === k; })[0]; };

function showEvent() {
  var e = eventInfo();
  $("f-eventHint").textContent = e.hint ? "Sent when: " + e.hint + "." : "";
  $("f-template").value = toFriendly(templates[e.key]);
  preview();
}

function preview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(function () {
    var key = $("f-event").value;
    call("POST", "/api/preview", { connectionId: editing ? editing.id : null, kind: key,
      template: fromFriendly($("f-template").value), platform: $("f-platform").value }).then(function (r) {
      if ($("f-event").value !== key) return;
      $("f-preview").innerHTML = r.card ? "" : (formatChat(r.text) || "<span class='hint'>(empty: nothing would be posted)</span>");
      if (r.card) $("f-preview").appendChild(cardPreview(r.text, r.card));
      $("f-source").textContent = r.source === "real" ? "your last real one, " + ago(r.at) : "example";
      var named = DETAILS.map(function (d) { return d[1]; });
      $("f-fields").replaceChildren.apply($("f-fields"), r.fields.filter(function (f) { return named.indexOf(f) < 0; }).map(function (f) {
        return el("button", { type: "button", text: f, on: { click: function () { insertText("{{" + f + "}}"); } } });
      }));
    }).catch(function (err) { $("f-preview").textContent = err.message; });
  }, 250);
}

function insertText(token) {
  var t = $("f-template"), at = t.selectionStart;
  t.value = t.value.slice(0, at) + token + t.value.slice(t.selectionEnd);
  t.focus(); t.selectionStart = t.selectionEnd = at + token.length;
  templates[$("f-event").value] = fromFriendly(t.value);
  preview();
}

// The message as the chat shows it: the sentence, then the compact card (area, title with Open, details, quote).
function cardPreview(text, card) {
  var sentence = el("div", { style: "margin-bottom:8px" });
  sentence.innerHTML = formatChat(text);
  return el("div", {}, [
    sentence,
    el("div", { "class": "chatcard" }, [
      el("div", { "class": "cc-row" }, [
        el("div", { "class": "grow" }, [
          card.topLabel ? el("div", { "class": "hint", text: ({ "task.created": "📄 ", "task.assigned": "👤 ", "task.completed": "⭐ " }[card.kind] || "") + card.topLabel }) : null,
          el("b", { text: card.title }),
          null
        ]),
        card.link ? el("span", { "class": "cc-button", text: "Open" }) : null
      ]),
      card.detailsHtml ? details(card.detailsHtml) : null,
      card.description ? el("div", { "class": "cc-quote", text: "“" + card.description + "”" }) : null
    ])
  ]);
}

// The card's clock row. The server escapes the text and only adds <font color> tags.
function details(html) {
  var row = el("div", { "class": "cc-details" });
  row.innerHTML = "🕒 " + html.replace(/<font color="(#[0-9a-f]{6})">/gi, "<span style=\"color:$1\">").replace(/<\/font>/g, "</span>");
  return row;
}

// A rough look at chat formatting: *bold*, _italic_, <url|text>. Escapes everything first.
function formatChat(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/&lt;users\/\d+&gt;/g, "<span class='mention'>@person</span>")
    .replace(/&lt;(https?:\/\/[^|\s]+?)\|([^&]+?)&gt;/g, "<u>$2</u>")
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1<i>$2</i>");
}

function setPlatform() {
  var p = CHAT_LINK[$("f-platform").value];
  $("f-chatUrlLabel").textContent = p.label;
  $("f-chatUrl").placeholder = p.placeholder;
  $("f-chatUrlHow").textContent = p.how;
}

$("add").addEventListener("click", function () { openForm(null); });
$("cancel").addEventListener("click", function () { $("dialog").close(); });
$("f-platform").addEventListener("change", function () { setPlatform(); preview(); });
$("f-event").addEventListener("change", showEvent);
$("f-template").addEventListener("input", function () { templates[$("f-event").value] = fromFriendly($("f-template").value); preview(); });
$("f-reset").addEventListener("click", function () {
  var e = eventInfo(); templates[e.key] = e.template; showEvent();
});
// The properties picked for the summary: [{label, name, ids}], one per property.
var chosen = [];
var found = [];
function isChosen(id) { return chosen.some(function (p) { return p.ids.indexOf(id) >= 0; }); }
function toggleProperty(prop, on) {
  chosen = chosen.filter(function (p) { return p.ids.indexOf(prop.id) < 0; });
  if (on) chosen.push({ label: prop.name, name: prop.name, ids: [prop.id] });
  renderChosen();
}
function renderChosen() {
  $("f-propChosen").replaceChildren.apply($("f-propChosen"), chosen.length ? chosen.map(function (p) {
    return el("button", { type: "button", text: p.label + " ×", on: { click: function () {
      chosen = chosen.filter(function (x) { return x !== p; }); renderChosen(); renderFound();
    } } });
  }) : [el("span", { "class": "hint", text: "none yet" })]);
}
function renderFound() {
  var boxes = found.map(function (prop) {
    var box = el("input", { type: "checkbox" });
    box.checked = isChosen(prop.id);
    box.addEventListener("change", function () { toggleProperty(prop, box.checked); });
    return el("label", { style: "display:flex" }, [box, document.createTextNode(" " + prop.name)]);
  });
  if (found.length > 1) {
    boxes.unshift(el("button", { type: "button", text: "Choose all " + found.length, style: "margin:4px 0", on: { click: function () {
      found.forEach(function (prop) { if (!isChosen(prop.id)) chosen.push({ label: prop.name, name: prop.name, ids: [prop.id] }); });
      renderChosen(); renderFound();
    } } }));
  }
  $("f-propResults").replaceChildren.apply($("f-propResults"), boxes);
}
function findProperties() {
  var q = $("f-propSearch").value.trim();
  if (q.length < 2) { $("f-propMsg").textContent = "Type at least 2 letters."; return; }
  $("f-propMsg").textContent = "Searching…";
  call("GET", "/api/properties?q=" + encodeURIComponent(q)).then(function (list) {
    found = list;
    $("f-propMsg").textContent = list.length ? list.length + (list.length === 100 ? "+ (showing the first 100; narrow the search)" : "") + " found. Tick the ones to include."
      : "No property names contain \"" + q + "\".";
    renderFound();
  }).catch(function (err) { $("f-propMsg").textContent = err.message; });
}
$("f-propFind").addEventListener("click", findProperties);
$("f-propSearch").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); findProperties(); } });

function showSummary() {
  var on = $("f-schedule").value !== "off";
  $("f-overdueWithinBox").style.display = $("f-includeOverdue").checked ? "flex" : "none";
  ["f-days", "f-onlyProperties", "f-onlyDated", "f-includeOverdue", "f-overdueWithin", "f-onlyAssigned", "f-properties"].forEach(function (id) { $(id).disabled = !on; });
  $("f-propertiesBox").style.display = $("f-onlyProperties").checked ? "block" : "none";
  // With an API key, pick from zInspector's list; without one, type the names.
  $("f-picker").style.display = state.summaryReadsZinspector ? "block" : "none";
  $("f-typed").style.display = state.summaryReadsZinspector ? "none" : "block";
  $("f-summarySource").textContent = !on ? "" : state.summaryReadsZinspector
    ? ($("f-onlyProperties").checked
      ? "Read from zInspector when it's sent, so it lists every matching open task."
      : "Choose properties to read the full list from zInspector. Without them, it lists only the tasks zInspector has sent this chat.")
    : "Lists the tasks zInspector has sent this chat so far. To list every open task, add a zInspector API key (see the guide).";
}
$("f-schedule").addEventListener("change", showSummary);
$("f-onlyProperties").addEventListener("change", showSummary);
$("f-includeOverdue").addEventListener("change", showSummary);

$("form").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var body = {
    name: $("f-name").value, platform: $("f-platform").value, chatUrl: $("f-chatUrl").value, token: $("f-token").value,
    only: $("f-only").value, templates: templates,
    summary: {
      schedule: $("f-schedule").value, days: Number($("f-days").value), onlyProperties: $("f-onlyProperties").checked,
      onlyDated: $("f-onlyDated").checked,
      includeOverdue: $("f-includeOverdue").checked, overdueWithin: Number($("f-overdueWithin").value),
      onlyAssigned: $("f-onlyAssigned").checked
    },
    alerts: Object.fromEntries(Array.prototype.map.call($("f-alerts").querySelectorAll("input"), function (b) {
      return [b.getAttribute("data-alert"), b.checked];
    }))
  };
  if (state.summaryReadsZinspector) body.summary.properties = chosen;
  else body.summary.propertyLines = $("f-properties").value.split("\n");
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
    el("td", {}, [input("p-email", p.email, "their work email")]),
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
      var contact = c.match(/contacts\.google\.com\/(?:u\/\d+\/)?person\/(\d{5,})/);
      if (contact) id = id || contact[1];
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
    $("bulkMsg").textContent = "No lines with both a name (or email) and an id or Contacts link were found.";
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
`;
