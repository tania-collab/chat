// Turns a zInspector webhook event into a chat message.

export const PLATFORMS = {
  "google-chat": { label: "Google Chat", urlPrefix: "https://chat.googleapis.com/" },
  slack: { label: "Slack", urlPrefix: "https://hooks.slack.com/" },
};

export const DEFAULT_COMPLETED = "Completed,Closed";
const BLANK = Symbol("blank line");

// Which kind of alert an event is: "test", "created", "updated", "completed", or null (not handled).
export function alertKind(event, settings = {}) {
  if (event.type === "webhook.test") return "test";
  if (event.type === "task.created") return "created";
  if (event.type !== "task.updated") return null;
  const status = event.data?.status?.value?.toLowerCase();
  const done = (settings.completedStatuses || DEFAULT_COMPLETED)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return status && done.includes(status) ? "completed" : "updated";
}

export function buildMessage(event, settings = {}, platform = "google-chat") {
  const d = event.data || {};
  const mention = mentionFor(d.assignedTo, settings.people, platform);
  const link = taskUrl(d.id, settings.taskUrl);
  const status = d.status?.value;

  switch (alertKind(event, settings)) {
    case "test":
      return "✅ zInspector is connected to this chat.";
    case "created":
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
    case "completed":
      return lines([
        "🎉 🎉 *Task completed!* 🎉 🎉",
        BLANK,
        `✅ *${d.type || "Task"}*${d.propertyName ? ` at ${d.propertyName}` : ""} is done.`,
        mention && `Great work, ${mention}! 🎊`,
        BLANK,
        d.referenceNumber && `#️⃣ Ref ${d.referenceNumber}`,
        link && `<${link}|See the finished task>`,
      ]);
    case "updated":
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

// Google Chat threads every message for one task together; Slack incoming webhooks can't thread.
export function deliveryUrl(connection, event) {
  const id = event.data?.id;
  if (connection.platform !== "google-chat" || id == null) return connection.chatUrl;
  const url = new URL(connection.chatUrl);
  url.searchParams.set("threadKey", `task-${id}`);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  return url.toString();
}

function mentionFor(person, people = [], platform) {
  if (!person) return null;
  const email = person.email?.toLowerCase();
  const match = email && people.find((p) => p.email?.toLowerCase() === email);
  if (platform === "google-chat" && match?.googleChatId) return `<users/${match.googleChatId}>`;
  if (platform === "slack" && match?.slackId) return `<@${match.slackId}>`;
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
