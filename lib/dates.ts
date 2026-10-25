// Dates shown in Purdue's time zone, whatever time zone the server runs in.
const TIME_ZONE = "America/Indiana/Indianapolis";

// "Oct 25, 2026, 1:15 AM"
export const when = (date: Date) => date.toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

// "Oct 25"
export const day = (date: Date) => date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });
