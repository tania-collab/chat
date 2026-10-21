// Google Chat cards for task alerts, written like a short note about a person:
//   header    "Tim has a new task"                         (the editable message)
//   subtitle  "from Laura · Conferences · Due Fri, Oct 30" (context)
//   body      the task's title in bold, the rest of its description as an italic quote
//   button    "Open the task"
// The @mention goes in the message text, because only text notifies.

const DESCRIPTION_MAX = 220;

export function taskCard({ header, subtitle, title, description, link }) {
  const body = [`<b>${escapeHtml(title)}</b>`, description && `<i>“${escapeHtml(description)}”</i>`].filter(Boolean).join("<br>");
  const widgets = [{ textParagraph: { text: body } }];
  if (link) widgets.push({ buttonList: { buttons: [{ text: "Open the task", onClick: { openLink: { url: link } } }] } });
  const card = { header: { title: header }, sections: [{ widgets }] };
  if (subtitle) card.header.subtitle = subtitle;
  return { cardId: "task", card };
}

// The same note as plain chat text, for Slack (incoming webhooks there don't take these cards).
export function cardAsText({ header, subtitle, title, description, link }) {
  return [
    `*${header}*`,
    link ? `<${link}|${title}>` : title,
    subtitle,
    description ? `> _${description}_` : "",
  ].filter(Boolean).join("\n");
}

// Context line and body for a task card. A finished task says how it ended; due date and priority no
// longer matter then.
export function cardContent(extras, kind, status) {
  const context = kind === "task.completed"
    ? [status, extras.area]
    : [extras.managerName && `from ${extras.managerName}`, extras.area, extras.dueDate && `Due ${extras.dueDate}`, extras.priorityFlag];
  return {
    subtitle: context.filter(Boolean).join(" · "),
    title: extras.plainTitle,
    description: extras.descriptionMore ? shortenTo(extras.descriptionMore, DESCRIPTION_MAX) : "",
    link: extras.taskLink,
  };
}

function shortenTo(s, max) {
  return s.length <= max ? s : s.slice(0, s.lastIndexOf(" ", max) > max * 0.6 ? s.lastIndexOf(" ", max) : max) + "…";
}

// Card text fields take a little HTML, so plain text is escaped.
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
