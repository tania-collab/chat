// The admin page, served at "/". Plain HTML + CSS, no build step; the script is in admin-script.js.

import { ADMIN_SCRIPT } from "./admin-script.js";

export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zInspector Chat Alerts</title>
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
  .cc-row { display: flex; gap: 12px; align-items: center; padding: 10px 12px; }
  .cc-quote { font-style: italic; padding: 0 12px 10px; }
  .cc-button { border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px; color: var(--accent); font-weight: 500; }
  .fields { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .fields button { font: 12px ui-monospace, Menlo, monospace; padding: 2px 8px; border-radius: 999px; background: var(--chip); }
  dialog::backdrop { background: rgba(0,0,0,.4); }
  ol.steps { padding-left: 20px; margin: 0; } ol.steps li { margin-bottom: 6px; }
  textarea#f-template { min-height: 120px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .details { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .details button { font-size: 13px; padding: 2px 10px; border-radius: 999px; background: var(--chip); }
  .health { margin-top: 10px; font-size: 14px; }
  .health.ok { color: var(--ok); } .health.bad { color: var(--bad); }
  ol.setup { margin: 12px 0 0; padding-left: 22px; display: grid; gap: 10px; }
  ol.setup li.done b { color: var(--ok); }
  .mention { background: var(--chip); border-radius: 999px; padding: 0 6px; color: var(--accent); }
</style>
</head>
<body>
<main>
  <div class="row"><h1 class="grow">zInspector → Chat</h1><span class="hint" id="who"></span></div>
  <p class="lead">Get zInspector tasks in your team's chat. zInspector decides which events it sends; here you choose the chat, which tasks, and the wording.</p>

  <div class="row" style="margin-top:24px">
    <h2 class="grow" style="margin:0">Chats</h2>
    <button class="primary" id="add">Add a chat</button>
  </div>
  <div id="connections" style="margin-top:12px"><div class="card empty">Loading…</div></div>

  <h2>Settings for all chats</h2>
  <p class="lead" style="margin-top:-6px">Chats work without changing these. Add people so their name becomes an @mention that notifies them.</p>
  <form class="card" id="settings">
    <label for="taskUrl">Task link <span class="hint">where Open goes; {id} becomes each task's number. Only change it if zInspector's task pages move.</span></label>
    <input type="url" id="taskUrl">
    <label for="completedStatuses">Statuses that mean "finished" <span class="hint">separated by commas; moving to one of these posts "🎉 … finished a task!"</span></label>
    <input type="text" id="completedStatuses">
    <label>People <span class="hint">with a Google Chat id, a person is @mentioned (and notified); without one their name shows in bold.
      To find the id: contacts.google.com → Directory → click the person → the long number at the end of the address
      (contacts.google.com/person/<b>1022…</b>). <b>Paste a list</b> adds several at once.</span></label>
    <div class="scroll"><table>
      <thead><tr><th>Work email</th><th>Google Chat id</th><th>Slack id</th><th></th></tr></thead>
      <tbody id="people"></tbody>
    </table></div>
    <div class="row" style="margin-top:8px">
      <button type="button" id="addPerson">Add person</button>
      <button type="button" id="pastePeople">Paste a list</button>
      <span class="grow"></span>
      <button class="primary" type="submit">Save</button>
    </div>
    <div class="msg" id="settingsMsg"></div>
  </form>

</main>

<dialog id="dialog">
  <form id="form" method="dialog">
    <h2 id="formTitle" style="margin-top:0">Add a chat</h2>
    <label for="f-name">Chat name <span class="hint">for you; e.g. the space's name</span></label>
    <input type="text" id="f-name" placeholder="Marketing tasks" required>
    <label for="f-platform">Chat app</label>
    <select id="f-platform">
      <option value="google-chat">Google Chat</option>
      <option value="slack">Slack</option>
    </select>
    <label for="f-chatUrl" id="f-chatUrlLabel">Google Chat link</label>
    <div class="hint" id="f-chatUrlHow"></div>
    <input type="url" id="f-chatUrl" required style="margin-top:4px">
    <label for="f-token">Security code <span class="hint">optional. If your zInspector webhook has a token, paste the same one, so only zInspector can post here.</span></label>
    <input type="password" id="f-token" autocomplete="off">
    <label for="f-only">Which tasks <span class="hint">others are kept track of, but not posted</span></label>
    <select id="f-only"></select>
    <label>What to post</label>
    <div class="checks" id="f-alerts"></div>
    <h2 style="margin:24px 0 4px">Wording</h2>
    <div class="hint">Click a detail to add it. A detail with no value (no due date, say) is left out on its own. Formatting: *bold*, _italic_.</div>
    <label for="f-event">Message for</label>
    <select id="f-event"></select>
    <div class="hint" id="f-eventHint"></div>
    <div class="split" style="margin-top:8px">
      <div>
        <div class="row"><b class="grow">Message</b><button type="button" id="f-reset">Use the default</button></div>
        <textarea id="f-template" spellcheck="false" style="margin-top:6px"></textarea>
        <div class="details" id="f-details"></div>
      </div>
      <div>
        <div class="row"><b class="grow">Preview</b><span class="hint" id="f-source"></span></div>
        <div class="preview" id="f-preview" style="margin-top:6px"></div>
      </div>
    </div>
    <details style="margin-top:8px"><summary class="hint">More details from zInspector</summary>
      <div class="fields" id="f-fields"></div>
    </details>
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

<script>` + ADMIN_SCRIPT + String.raw`</script>
</body>
</html>`;
