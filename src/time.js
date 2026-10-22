// Dates as the team sees them: Pacific time, counted in whole days.

export const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;

// Today's date (YYYY-MM-DD) in Pacific time.
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

// Whole days from today to a date (YYYY-MM-DD, or an ISO time whose date part is used): 1 = tomorrow.
export function daysFromToday(value, now = new Date()) {
  const ymd = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return Math.round((Date.parse(ymd) - Date.parse(localDate(now))) / DAY_MS);
}
