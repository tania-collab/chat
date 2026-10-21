# zInspector → Chat

A small web app that sends zInspector task alerts into Google Chat and Slack, for as many chats as you like.

zInspector's webhooks send a raw event that chat apps reject. This app sits in between: each **connection**
has its own address that you paste into a zInspector webhook. When an event arrives, the app checks the
webhook token, writes a readable message, and posts it to that connection's chat.

| zInspector event | Message |
|---|---|
| `task.created` | ✨ *We have a new task!* with type, property, assignee, status, priority, ref, description |
| `task.updated`, status is a "done" status | 🎉 *Task completed!* |
| `task.updated`, any other status | ✏️ *Task updated:* with the current status |
| `webhook.test` (zInspector's **Send test**) | ✅ zInspector is connected to this chat. |

On the admin page you can:

- add, edit and delete connections (Google Chat or Slack), and pick which alerts each gets,
- copy each connection's address for zInspector,
- send a test message and see the last 20 deliveries (with the chat's error when one fails),
- set the task link, which statuses count as "done", and people's chat ids for real @mentions.

Google Chat messages for the same task stack in one thread. Empty fields are left out.

It runs on Cloudflare Workers (free plan) with Workers KV for storage. No other server.

## Put it online (one time, about 10 minutes)

1. **Deploy from GitHub.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** →
   pick `tania-collab/chat` and keep the defaults. Cloudflare builds it and creates the storage
   (`RELAY`) on the first deploy. Every later push to `main` redeploys.
2. **Set the admin password.** Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**,
   name `ADMIN_PASSWORD`, a long password of your choice → **Deploy**.
3. **Open the app** at `https://zinspector-chat-relay.<your-subdomain>.workers.dev`. The browser asks for a
   user name and password: type anything as the user name and your `ADMIN_PASSWORD` as the password.

If the first build fails on the KV namespace, create one by hand (**Storage & Databases** → **KV** →
**Create**, name `zinspector-chat-relay`), put its id in `wrangler.toml` under `[[kv_namespaces]]`
(`id = "..."`), and push.

## Connect a chat

1. **Get the chat's webhook URL.**
   Google Chat: open the space → space name → **Apps & integrations** → **Webhooks** → **Add webhook**.
   Slack: create an app with **Incoming Webhooks** turned on and add one for the channel.
2. In the app, click **Add a chat**, paste the URL, set a token, and pick the alerts.
3. In zInspector, add a webhook with the connection's **Address for zInspector**, the same token, and the events
   **Task created** and **Task updated**. Press **Send test**.

## Settings

| Setting | What it does |
|---|---|
| Task link | Adds an "Open in zInspector" link to each message. `{id}` becomes the task id. |
| "Done" statuses | Status names that post the celebration (default `Completed,Closed`). |
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
| `src/messages.js` | message wording per event, @mentions, threads |
| `src/store.js` | connections, settings and logs in KV, input checks |
| `src/admin.js` | the admin page (HTML + JS) |
