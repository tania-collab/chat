// Google Chat cards for task alerts. The message text above the card says who and what
// ("📌 @AJ Muldowney, you've got a new task from Tania"); the card is one compact block:
//   [icon] area
//          Task title                 [Open]
//   [clock] Due tomorrow · High priority      (colored by urgency; how a finished task ended)
//   "rest of a long description"
// Only text can @mention, so the person stays in the sentence, not in the card.

const DESCRIPTION_MAX = 220;

// Google Chat's built-in icons, one per kind of alert, so the card has something to anchor the eye.
const ICON = { "task.created": "DESCRIPTION", "task.assigned": "PERSON", "task.completed": "STAR" };

export function taskCard({ kind, title, topLabel, detailsHtml, description, link }) {
  const item = { text: `<b>${escapeHtml(title)}</b>`, wrapText: true };
  if (ICON[kind]) item.startIcon = { knownIcon: ICON[kind] };
  if (topLabel) item.topLabel = topLabel;
  if (link) item.button = { text: "Open", onClick: { openLink: { url: link } } };
  const widgets = [{ decoratedText: item }];
  if (detailsHtml) widgets.push({ decoratedText: { startIcon: { knownIcon: "CLOCK" }, text: detailsHtml, wrapText: true } });
  if (description) widgets.push({ textParagraph: { text: `<i>“${escapeHtml(description)}”</i>` } });
  return { cardId: "task", card: { sections: [{ widgets }] } };
}

// The same block as plain chat text, for Slack (incoming webhooks there don't take these cards).
export function cardAsText({ title, topLabel, detailsText, description, link }) {
  return [
    link ? `*<${link}|${title}>*` : `*${title}*`,
    [topLabel, detailsText].filter(Boolean).join(" · "),
    description ? `> _${description}_` : "",
  ].filter(Boolean).join("\n");
}

// Colors carry meaning: red for overdue and highest priority, orange for high, amber for due today or
// tomorrow, green for done, grey for "not set" and normal.
const COLOR = { overdue: "#d93025", highest: "#d93025", high: "#e8710a", soon: "#e37400", done: "#188038", none: "#5f6368", normal: "#5f6368", low: "#5f6368" };

// What a task card shows. Open tasks always show their due date and priority (saying when they're not set);
// a finished task shows how it ended. The sentence above already says who and how early or late.
export function cardContent(extras, kind, status) {
  let parts;
  if (kind === "task.completed") {
    const word = /^work complete$/i.test(status) ? "Done" : status;
    parts = [[`✓ ${extras.finishLabel || word}`.replace(/^✓ Work Complete/, "✓ Done"), "done"]];
  } else {
    parts = [
      [(extras.dueLabel || "No due date yet").replace(/^⚠️ /, ""), extras.dueTone || "none"],
      [extras.priorityLabel || "Normal priority", extras.priorityTone || "normal"],
    ];
  }
  return {
    kind,
    title: extras.plainTitle,
    topLabel: extras.area || extras.taskType,
    detailsHtml: parts.map(([text, tone]) => (COLOR[tone] ? `<font color="${COLOR[tone]}">${escapeHtml(text)}</font>` : escapeHtml(text))).join(" · "),
    detailsText: parts.map(([text]) => text).join(" · "),
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
