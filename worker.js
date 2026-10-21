// zInspector -> Google Chat relay (Cloudflare Worker).
//
// zInspector POSTs its raw webhook event to https://<worker>/<route>.
// The worker checks the X-zInspector-Webhook-Token header, turns the event
// into a Google Chat text message, and posts it to that route's Chat space.
//
// Settings (Cloudflare dashboard -> Worker -> Settings -> Variables and Secrets):
//   ROUTES             secret, JSON: {"<route>": {"chat": "<Google Chat webhook URL>", "token": "<zInspector webhook token>"}}
//   CHAT_USER_IDS      optional, JSON: {"<email>": "<numeric Google Chat user id>"} to @mention assignees
//   TASK_URL           optional, e.g. "https://portfolio.zinspector.com/task/{id}" to link each task
//   COMPLETED_STATUSES optional, comma-separated status names that mean "done" (default "Completed,Closed")

const DEFAULT_COMPLETED = "Completed,Closed";
const BLANK = Symbol("blank line");

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("zInspector -> Google Chat relay is running.", { status: 200 });
    }

    const routes = parseJson(env.ROUTES, {});
    const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
    const route = routes[name];
    if (!route || !route.chat) return new Response(`Unknown route "${name}"`, { status: 404 });

    const token = request.headers.get("x-zinspector-webhook-token") || "";
    if (route.token && !safeEqual(token, route.token)) {
      return new Response("Bad webhook token", { status: 401 });
    }

    let event;
    try {
      event = await request.json();
    } catch {
      return new Response("Body is not JSON", { status: 400 });
    }

    const text = buildMessage(event, env);
    if (!text) return new Response(`Ignored event "${event.type}"`, { status: 200 });

    const chat = await fetch(threadUrl(route.chat, event), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
    // Pass Google's answer back so zInspector's Delivery History shows it.
    const body = await chat.text();
    return new Response(body, { status: chat.ok ? 200 : 502 });
  },
};

export function buildMessage(event, env = {}) {
  const d = event.data || {};
  const chatUserIds = Object.fromEntries(
    Object.entries(parseJson(env.CHAT_USER_IDS, {})).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const mention = mentionFor(d.assignedTo, chatUserIds);
  const link = taskUrl(d.id, env.TASK_URL);
  const completed = (env.COMPLETED_STATUSES || DEFAULT_COMPLETED)
    .split(",")
    .map((s) => s.trim().toLowerCase());
  const status = d.status?.value;

  switch (event.type) {
    case "webhook.test":
      return "✅ zInspector is connected to this space.";
    case "task.created":
      return lines([
        "✨ *We have a new task!* ✨",
        BLANK,
        d.type && `📋 *${d.type}*`,
        d.propertyName && `🏠 ${[d.propertyName, d.propertyAddress].filter(Boolean).join(" · ")}`,
        mention && `👤 Assigned to ${mention}`,
        status && `🎯 Status: ${status}${d.priority != null ? ` · Priority: ${d.priority}` : ""}`,
        d.referenceNumber && `#️⃣ Ref ${d.referenceNumber}`,
        d.description && BLANK,
        d.description && `> ${d.description}`,
        link && BLANK,
        link && `<${link}|Open in zInspector>`,
      ]);
    case "task.updated":
      if (status && completed.includes(status.toLowerCase())) {
        return lines([
          "🎉 🎉 *Task completed!* 🎉 🎉",
          BLANK,
          `✅ *${d.type || "Task"}*${d.propertyName ? ` at ${d.propertyName}` : ""} is done.`,
          mention && `Great work, ${mention}! 🎊`,
          BLANK,
          d.referenceNumber && `#️⃣ Ref ${d.referenceNumber}`,
          link && `<${link}|See the finished task>`,
        ]);
      }
      return lines([
        `✏️ *Task updated:* ${d.type || "Task"}`,
        BLANK,
        d.propertyName && `🏠 ${d.propertyName}`,
        mention && `👤 ${mention}`,
        status && `🔄 Status: *${status}*`,
        d.referenceNumber && `#️⃣ Ref ${d.referenceNumber}`,
        link && BLANK,
        link && `<${link}|View task>`,
      ]);
    default:
      return null;
  }
}

// One Chat thread per task, so updates stack under the original alert.
export function threadUrl(chatUrl, event) {
  const id = event.data?.id;
  if (id == null) return chatUrl;
  const url = new URL(chatUrl);
  url.searchParams.set("threadKey", `task-${id}`);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  return url.toString();
}

function mentionFor(person, chatUserIds) {
  if (!person) return null;
  const id = person.email && chatUserIds[person.email.toLowerCase()];
  if (id) return `<users/${id}>`;
  return person.name ? `*${person.name}*` : null;
}

function taskUrl(id, template) {
  return template && id != null ? template.replace("{id}", encodeURIComponent(id)) : null;
}

// Drop lines whose value is missing or empty, then collapse repeated blank lines.
function lines(parts) {
  return parts
    .filter((p) => p === BLANK || (typeof p === "string" && p))
    .map((p) => (p === BLANK ? "" : p))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
