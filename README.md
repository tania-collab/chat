# zInspector → Google Chat relay

A small Cloudflare Worker that posts zInspector task alerts into Google Chat spaces.

zInspector sends its raw webhook event, which Google Chat rejects. This worker sits in between:
it checks zInspector's webhook token, turns the event into a readable Chat message, and posts it.

| zInspector event | Chat message |
|---|---|
| `task.created` | ✨ *We have a new task!* with type, property, assignee, status, priority, ref, description |
| `task.updated` (status is a "done" status) | 🎉 *Task completed!* |
| `task.updated` (any other status) | ✏️ *Task updated:* with the current status |
| `webhook.test` (the **Send test** button) | ✅ zInspector is connected to this space. |

All messages for the same task stack in one Chat thread. Empty fields are left out.

## Set it up (about 5 minutes, free Cloudflare plan)

1. **Get the Google Chat webhook URL.** In Google Chat, open the space → space name → **Apps & integrations**
   → **Webhooks** → **Add webhook**. Copy the URL (it starts with `https://chat.googleapis.com/v1/spaces/`).
2. **Create the worker.** In the Cloudflare dashboard: **Workers & Pages** → **Create** → **Create Worker**,
   name it `zinspector-chat-relay`, **Deploy**, then **Edit code**. Replace everything with the contents of
   [`worker.js`](worker.js) and **Deploy** again.
   (Developers can instead run `npx wrangler deploy` from this folder.)
3. **Add your chats.** Worker → **Settings** → **Variables and Secrets** → **Add**, type **Secret**,
   name `ROUTES`, value (one entry per chat space; the name before the colon is your choice):

   ```json
   {
     "marketing": {
       "chat": "https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...",
       "token": "the webhook token you set in zInspector"
     }
   }
   ```

4. **Point zInspector at it.** In zInspector's webhook settings, set the URL to
   `https://zinspector-chat-relay.<your-subdomain>.workers.dev/marketing` (the route name from step 3),
   keep the same webhook token, pick **Task created** and **Task updated**, and press **Send test**.
   "✅ zInspector is connected to this space." should appear in the chat.

To add another chat, add another entry to `ROUTES` and another zInspector webhook ending in its name.

## Optional settings

Add these the same way (type **Text** is fine; none are secret):

| Name | Example | What it does |
|---|---|---|
| `CHAT_USER_IDS` | `{"tania@zinspector.com": "123456789012345678901"}` | Real @mentions. Google needs the numeric Chat user id (Admin console or Directory API); without it the name shows in bold. |
| `TASK_URL` | `https://portfolio.zinspector.com/task/{id}` | Adds an "Open in zInspector" link. `{id}` becomes the task id. |
| `COMPLETED_STATUSES` | `Completed,Closed` (default) | Which status names count as "done" and trigger the celebration. |

## Good to know

- If Google Chat refuses a message, the worker answers zInspector with 502 and Google's reason, so it shows in
  zInspector's Delivery History.
- A wrong or missing webhook token gets 401 and nothing is posted.
- Every update of a task in a "done" status posts the celebration again: zInspector doesn't send the previous
  status, so the worker can't tell a fresh completion from a later edit.
- Never commit the `ROUTES` value: the Chat URL and the token are both passwords.

## Tests

`npm test` (Node 20+, no install needed).
