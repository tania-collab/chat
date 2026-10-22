// Default copy from earlier versions. A saved message still identical to one of these was never edited,
// so it moves to the current default.
export const LEGACY_TEMPLATES = {
  "task.created": [
    "✨ *We have a new task!* ✨\n\n📋 *{{data.type}}*\n🏠 {{data.propertyName}} · {{data.propertyAddress}}\n👤 Assigned to {{mention}}\n🎯 Status: {{data.status}} · Priority: {{data.priority}}\n#️⃣ Ref {{data.referenceNumber}}\n\n> {{data.description}}\n\n<{{taskLink}}|Open in zInspector>",
    "🆕 *New task* · {{taskTitle}} · Ref {{data.referenceNumber}}\n🏠 {{data.propertyName}} · {{data.propertyAddress}}\n👤 {{assigneeOrUnassigned}} · 📅 Due {{dueDate}} · {{priorityFlag}}\n> {{shortDescription}}",
    "🆕 *New task* · {{taskTitle}} · Ref {{data.referenceNumber}}\n🏠 {{data.propertyName}} · 📋 {{taskType}}\n👤 {{assigneeOrUnassigned}} · 📅 Due {{dueDate}} · {{priorityFlag}}\n> {{descriptionMore}}",
    "{{assigneeFirstName}} has a new task",
    "{{assignee}} has a new task · from {{managerName}}"
  ],
  "task.updated": [
    "✏️ *Task updated:* {{data.type}}\n\n🏠 {{data.propertyName}}\n👤 {{mention}}\n🔄 Status: *{{data.status}}*\n#️⃣ Ref {{data.referenceNumber}}\n\n<{{taskLink}}|View task>",
    "✏️ {{taskTitle}} · Ref {{data.referenceNumber}}\n{{changes}}",
    "✏️ {{taskTitle}}\n{{changes}}"
  ],
  "task.completed": [
    "🎉 🎉 *Task completed!* 🎉 🎉\n\n✅ *{{data.type}}* is done.\n🏠 {{data.propertyName}}\nGreat work, {{mention}}! 🎊\n\n#️⃣ Ref {{data.referenceNumber}}\n<{{taskLink}}|See the finished task>",
    "✅ *{{data.status}}* · {{taskTitle}} · Ref {{data.referenceNumber}}\n🎉 Nice work, {{assignee}}!",
    "{{assigneeFirstName}} finished a task ✅",
    "🎉 {{assigneeFirstName}} finished a task!"
  ],
  "task.message.created": [
    "💬 *New message on a task:* {{data.type}}\n\n🏠 {{data.propertyName}}\n#️⃣ Ref {{data.referenceNumber}}\n\n> {{data.message}}\n\n<{{taskLink}}|Reply in zInspector>",
    "💬 *New message* · {{taskTitle}} · Ref {{data.referenceNumber}}\n> {{messageText}}\n— {{messageAuthor}}",
    "💬 *New message* · {{taskTitle}}\n> {{messageText}}\n— {{messageAuthor}}"
  ],
  "report.distributed": [
    "📄 *A report was sent*\n\n🏠 {{data.propertyName}} · {{data.propertyAddress}}\n#️⃣ Ref {{data.referenceNumber}}",
    "📄 *Report sent* · {{data.propertyName}} · Ref {{data.referenceNumber}}\n🏠 {{data.propertyAddress}}"
  ],
  "zdata.changed": [
    "🗂️ *zData {{data.actionType}}:* {{data.area}} › {{data.detail}}\n\n🏠 {{data.propertyName}}\nValue: {{data.zData}}",
    "🗂️ *{{data.area}} › {{data.detail}}* {{data.actionType}} · {{data.propertyName}}\n{{data.zData}}"
  ],
  "other": [
    "🔔 *zInspector: {{type}}*\n\n🏠 {{data.propertyName}}\n📋 {{data.type}}",
    "🔔 *{{type}}* · {{data.propertyName}} · {{data.type}}"
  ],
  "task.assigned": [
    "{{assigneeFirstName}} was assigned a task",
    "{{assignee}} was assigned a task · from {{managerName}}"
  ]
};
