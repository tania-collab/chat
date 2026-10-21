// Default copy from earlier versions. A saved message still identical to one of these was never edited,
// so it moves to the current default.
export const LEGACY_TEMPLATES = {
  "task.created": [
    "✨ *We have a new task!* ✨\n\n📋 *{{data.type}}*\n🏠 {{data.propertyName}} · {{data.propertyAddress}}\n👤 Assigned to {{mention}}\n🎯 Status: {{data.status}} · Priority: {{data.priority}}\n#️⃣ Ref {{data.referenceNumber}}\n\n> {{data.description}}\n\n<{{taskLink}}|Open in zInspector>"
  ],
  "task.updated": [
    "✏️ *Task updated:* {{data.type}}\n\n🏠 {{data.propertyName}}\n👤 {{mention}}\n🔄 Status: *{{data.status}}*\n#️⃣ Ref {{data.referenceNumber}}\n\n<{{taskLink}}|View task>"
  ],
  "task.completed": [
    "🎉 🎉 *Task completed!* 🎉 🎉\n\n✅ *{{data.type}}* is done.\n🏠 {{data.propertyName}}\nGreat work, {{mention}}! 🎊\n\n#️⃣ Ref {{data.referenceNumber}}\n<{{taskLink}}|See the finished task>"
  ],
  "task.message.created": [
    "💬 *New message on a task:* {{data.type}}\n\n🏠 {{data.propertyName}}\n#️⃣ Ref {{data.referenceNumber}}\n\n> {{data.message}}\n\n<{{taskLink}}|Reply in zInspector>"
  ],
  "report.distributed": [
    "📄 *A report was sent*\n\n🏠 {{data.propertyName}} · {{data.propertyAddress}}\n#️⃣ Ref {{data.referenceNumber}}"
  ],
  "zdata.changed": [
    "🗂️ *zData {{data.actionType}}:* {{data.area}} › {{data.detail}}\n\n🏠 {{data.propertyName}}\nValue: {{data.zData}}"
  ],
  "other": [
    "🔔 *zInspector: {{type}}*\n\n🏠 {{data.propertyName}}\n📋 {{data.type}}"
  ]
};
