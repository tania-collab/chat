// Google Chat cards for task alerts. The message text above the card says who and what
// ("@AJ Muldowney has a new task · from Tania"); the card is one compact block:
//   area                       (top label)
//   Task title         [Open]  (bold, with the button on the right)
//   Due Sat, Oct 24            (bottom label: due date and priority, or how a finished task ended)
//   "rest of a long description"
// Only text can @mention, so the person stays in the sentence, not in the card.

const DESCRIPTION_MAX = 220;

export function taskCard({ title, topLabel, bottomLabel, description, link }) {
  const item = { text: `<b>${escapeHtml(title)}</b>`, wrapText: true };
  if (topLabel) item.topLabel = topLabel;
  if (bottomLabel) item.bottomLabel = bottomLabel;
  if (link) item.button = { text: "Open", onClick: { openLink: { url: link } } };
  const widgets = [{ decoratedText: item }];
  if (description) widgets.push({ textParagraph: { text: `<i>“${escapeHtml(description)}”</i>` } });
  return { cardId: "task", card: { sections: [{ widgets }] } };
}

// The same block as plain chat text, for Slack (incoming webhooks there don't take these cards).
export function cardAsText({ title, topLabel, bottomLabel, description, link }) {
  return [
    link ? `*<${link}|${title}>*` : `*${title}*`,
    [topLabel, bottomLabel].filter(Boolean).join(" · "),
    description ? `> _${description}_` : "",
  ].filter(Boolean).join("\n");
}

// What a task card shows. A finished task says how it ended; due date and priority no longer matter then.
export function cardContent(extras, kind, status) {
  const details = kind === "task.completed"
    ? [status]
    : [extras.dueDate && `Due ${extras.dueDate}`, extras.priorityFlag];
  return {
    title: extras.plainTitle,
    topLabel: extras.area || extras.taskType,
    bottomLabel: details.filter(Boolean).join(" · "),
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
