# zInspector → Chat

A small web app that turns zInspector webhooks into Google Chat and Slack messages, for as many chats as you like.

zInspector's webhooks send a raw event that chat apps reject. This app sits in between: each **connection**
has its own address that you paste as the **Destination URL** of a zInspector webhook. zInspector decides
which events it sends (events and filters are set on its Edit Webhook screen); the app checks the webhook
token, writes the message for that event, and posts it to the connection's chat.

New, newly assigned and finished tasks arrive in Google Chat as a sentence about the person plus one compact
card:

```
@AJ Muldowney has a new task · from Tania        ← the message (editable per chat)
┌──────────────────────────────────────────┐
│ BizDev / Strategic                       │     ← area
│ Marketing Inbox test              [Open] │     ← the task's title (its description)
│ Due Sat, Oct 24                          │     ← due date, priority if not normal
└──────────────────────────────────────────┘
```

The person is @mentioned (which notifies them) on a new task or a task just given to them, when their Google
Chat id is on file (People). Finished tasks name them without a ping. Slack gets the same message as text.
Other alerts are short text messages:

| zInspector event | Message |
|---|---|
| Task created | "@Tim Wallace has a new task · from Laura" + card |
| Task updated that gives the task to someone | "@Tim Wallace was assigned a task · from Laura" + card |
| Task updated into a "done" status | "🎉 Tim finished a task!" + card with how it ended (Work Complete / Closed) |
| Other task updates (off by default) | ✏️ task · then only what changed: `Status: New → In Progress`, `Due: Nov 2`… |
| New task message (off by default) | 💬 *New message* · task; the first lines of the message, without signature; its author |
| Reports distributed | 📄 *Report sent* · property · Ref |
| zData changed | 🗂️ *area › detail* action · property; the value |
| any other event | 🔔 *event name* · property |
| Send test | ✅ zInspector is connected to this chat. |

Messages about one task share a Google Chat thread. To tell what changed, the app remembers the last state of
the 300 most recently seen tasks per chat. Messages still on an earlier default switch to the current one;
edited messages stay as written.

**Weekly digest** (Mondays 8:30am Pacific, on by default per chat): one card with what's open per person
(overdue first, with "overdue since Fri" / "due Wed"), how many are due this week, and last week's new and
finished counts. People with overdue tasks are @mentioned when their chat id is on file. **Send digest now**
on a chat's card posts it right away. The digest only knows tasks zInspector has sent since the chat was
connected; older tasks join as soon as they're updated. The schedule is the `[triggers]` cron in
`wrangler.toml`.

**What a chat hears about** is set per chat:

- **Post task alerts for**: tasks with someone assigned (default), with someone assigned or a next to-do, or all
  tasks. In zInspector, incoming emails get a next to-do automatically, so "assigned" keeps the chat to real work.
- **Post these alerts**: new tasks ✓, newly assigned tasks ✓, finished tasks ✓ (a "done" status), other changes
  (status, dates, priority…) and new messages on a task. The last two are off by default.

Every update is still tracked (that's how "finished" and "newly assigned" are detected), just not posted. The
first time the app sees a task through an update (for example a bulk clean-up of old tasks), it remembers it
without posting. Recent deliveries says why each alert wasn't posted.

The assignee is @mentioned on a new task, when a task is assigned to them, and on completion, not on every
update. To tell what changed, the app remembers the last state of the 300 most recently seen tasks per chat.
Messages still on an earlier default switch to the current one; edited messages stay as written.

### Message templates

- `{{data.propertyName}}` puts in a value from the event; `{{data.status}}` shows a status's name, `{{data.assignedTo}}`
  a person's name.
- Ready-made values: `{{assigneeFirstName}}`, `{{managerName}}`, `{{area}}`, `{{taskTitle}}` (the task's title, i.e. its description, linked), `{{taskType}}`, `{{descriptionMore}}`, `{{assignee}}`, `{{assigneeOrUnassigned}}`, `{{changes}}`,
  `{{dueDate}}`, `{{priorityFlag}}`, `{{shortDescription}}`, `{{messageText}}`, `{{messageAuthor}}`, `{{taskLink}}`.
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
| People | email → Google Chat user id and/or Slack member id, for real @mentions. Without an id the name shows in bold. Google Chat needs the numeric id (from Google Contacts, below), not the email. |

### Finding Google Chat ids, and adding many people at once

A person's Google Chat user id is the long number at the end of their Google Contacts address:
**contacts.google.com** → **Directory** → click the person → `https://contacts.google.com/person/102245061761548994358`.

Under **People**, click **Paste a list** and paste one person per line: a name or email and the id or that
Contacts link, in any order, separated by spaces, commas or tabs. A name becomes `name@zinspector.com` (the
domain is editable). People already in the list are updated.

zInspector accounts may tag staff emails (`aj+onsight@zinspector.com`); `aj@zinspector.com` in People matches
them in every account.

## Good to know

- A wrong or missing token gets 401 and nothing is posted. A connection without a token accepts anyone who
  knows its address; the app flags it.
- If the chat refuses a message, zInspector gets 502 with the chat's reason, so it shows in its Delivery History.
- The free KV plan allows 1,000 writes a day; each delivery is one write.
- Chat webhook URLs and tokens are passwords. They live only in the app's storage, never in this repo.

## Develop

`npm test` runs the tests (Node 20+, nothing to install). `npx wrangler dev` runs the app locally
(put `ADMIN_PASSWORD=...` in `.dev.vars`).

| File | What |
|---|---|
| `src/worker.js` | routes: `/hook/<id>` relay, `/` admin page, `/api/...` |
| `src/messages.js` | events, default copy, the template engine, @mentions, threads |
| `src/taskview.js` | task state, what changed, ready-made values |
| `src/cards.js` | the Google Chat card (and its Slack text version) |
| `src/digest.js` | the weekly digest |
| `src/legacy.js` | earlier default copy, to move unedited messages forward |
| `src/store.js` | connections, settings, logs and last events in KV, input checks |
| `src/admin.js` | the admin page (HTML + JS) |
