# zInspector → Chat

A small web app that turns zInspector webhooks into Google Chat and Slack messages, for as many chats as you like.

zInspector's webhooks send a raw event that chat apps reject. This app sits in between: each **connection**
has its own address that you paste as the **Destination URL** of a zInspector webhook. zInspector decides
which events it sends (events and filters are set on its Edit Webhook screen); the app checks the webhook
token, writes the message for that event, and posts it to the connection's chat.

Each event has its own message, with default copy you can edit per connection:

| zInspector event | Default message starts with |
|---|---|
| Task created (`task.created`) | ✨ *We have a new task!* |
| Task updated (`task.updated`) | ✏️ *Task updated:* |
| Task updated to a "done" status | 🎉 *Task completed!* |
| New task message (`task.message.created`) | 💬 *New message on a task:* |
| Reports distributed (`report.distributed`) | 📄 *A report was sent* |
| zData changed (`zdata.changed`) | 🗂️ *zData Updated:* area › detail |
| any other event | 🔔 *zInspector: event name* |
| Send test (`webhook.test`) | ✅ zInspector is connected to this chat. |

On the admin page you can:

- add, edit and delete connections (Google Chat or Slack),
- copy each connection's Destination URL for zInspector,
- edit each event's message with a live preview; once a real event of that kind arrives, the preview uses it
  and lists its fields, so you can click a field to insert it,
- send a test message and see the last 20 deliveries (with the chat's error when one fails),
- set the task link, which statuses count as "done", and people's chat ids for real @mentions.

### Message templates

- `{{data.propertyName}}` puts in a value from the event; `{{data.status}}` shows a status's name, `{{data.assignedTo}}`
  a person's name.
- `{{mention}}` @mentions the assignee (see People below); `{{taskLink}}` is the task's page in zInspector.
- A line, or a part of a line between ` · `, is left out when one of its fields is empty.
- Formatting: `*bold*`, `_italic_`, `<https://link|text>`.

The default copy for New task message and Reports distributed guesses some field names (`data.message`),
because zInspector's docs don't list those payloads. After the first real one arrives, open **Edit messages**
and pick the right fields from the list.

Google Chat messages for the same task stack in one thread. It runs on Cloudflare Workers (free plan) with
Workers KV for storage. No other server.

## Put it online (one time, about 10 minutes)

1. **Deploy from GitHub.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** →
   pick `tania-collab/chat` and keep the defaults. Cloudflare builds it and creates the storage
   (`RELAY`) on the first deploy. Every later push to `main` redeploys.
2. **Turn on sign-in** (next section). Until then the app shows "Setup is not finished".

If the first build fails on the KV namespace, create one by hand (**Storage & Databases** → **KV** →
**Create**, name `zinspector-chat-relay`), put its id in `wrangler.toml` under `[[kv_namespaces]]`
(`id = "..."`), and push.

## Sign-in for your team (Cloudflare Access, free up to 50 people)

People open the app, type their work email, and get a 6-digit code by email. No passwords to share.
The page shows who is signed in, and each chat shows who added it.

1. **Turn on Access.** Worker → **Settings** → **Domains & Routes** → on the `workers.dev` row, click
   **Enable Cloudflare Access**. (The first time, Cloudflare asks you to pick a team name for Zero Trust;
   the free plan is fine.) Cloudflare shows two values: copy the **team domain**
   (like `yourteam.cloudflareaccess.com`) and the **Application Audience (AUD) tag**.
2. **Choose who can sign in.** Click **Manage Cloudflare Access** (or Zero Trust → **Access** →
   **Applications** → the worker's application) → **Policies** → edit the policy: **Include** →
   **Emails ending in** → `@zinspector.com` (or list people one by one under **Emails**). Save.
3. **Let zInspector through.** zInspector can't sign in, so its webhook addresses must skip Access (each
   connection's token still protects them). Zero Trust → **Access** → **Applications** → **Add an
   application** → **Self-hosted**. Domain: the worker's `workers.dev` address, **Path**: `hook`.
   Policy: action **Bypass**, **Include** → **Everyone**. Save.
4. **Tell the app.** Worker → **Settings** → **Variables and Secrets** → add `ACCESS_TEAM_DOMAIN` (the team
   domain) and `ACCESS_AUD` (the AUD tag), type **Text** → **Deploy**.

Open the app: you get Cloudflare's sign-in page, then the app with "Signed in as …" at the top.
To remove someone, take them off the policy in step 2.

The app checks Cloudflare's sign-in itself, so if Access is ever switched off the page refuses everyone
rather than opening up.

**Just testing on your own?** Instead of Access, add a secret `ADMIN_PASSWORD`; the browser then asks for it
(any user name). Once `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, the password no longer works.

## Connect a chat

1. **Get the chat's webhook URL.**
   Google Chat: open the space → space name → **Apps & integrations** → **Webhooks** → **Add webhook**.
   Slack: create an app with **Incoming Webhooks** turned on and add one for the channel.
2. In the app, click **Add a chat**, paste the URL and set a token.
3. In zInspector's **Edit Webhook**, set the **Destination URL** to the connection's address, use the same
   token, and pick the events and filters there. Press **Send test**.

## Settings

| Setting | What it does |
|---|---|
| Task link | The "Open in zInspector" link in task messages, `https://dashboard.zinspector.com/task/view/{id}` by default; `{id}` becomes each task's number. |
| "Done" statuses | A Task updated to one of these posts the Task completed message (default `Work Complete,Closed`; Canceled and Deferred don't). |
| People | zInspector email → Google Chat user id and/or Slack member id, for real @mentions. Without an id the name shows in bold. Google Chat needs the numeric id (Admin console or Directory API), not the email. |

## Good to know

- A wrong or missing token gets 401 and nothing is posted. A connection without a token accepts anyone who
  knows its address; the app flags it.
- If the chat refuses a message, zInspector gets 502 with the chat's reason, so it shows in its Delivery History.
- zInspector doesn't send the previous status, so a task edited while already "done" posts the celebration again.
- The free KV plan allows 1,000 writes a day; each delivery is one write.
- Chat webhook URLs and tokens are passwords. They live only in the app's storage, never in this repo.

## Develop

`npm test` runs the tests (Node 20+, nothing to install). `npx wrangler dev` runs the app locally
(put `ADMIN_PASSWORD=...` in `.dev.vars`).

| File | What |
|---|---|
| `src/worker.js` | routes: `/hook/<id>` relay, `/` admin page, `/api/...` |
| `src/messages.js` | events, default copy, the template engine, @mentions, threads |
| `src/store.js` | connections, settings, logs and last events in KV, input checks |
| `src/admin.js` | the admin page (HTML + JS) |
