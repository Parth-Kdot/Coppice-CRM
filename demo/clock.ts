// The fixed anchor for every date in the prototypes. Nothing reads the real clock, so the server and
// the browser render identical text, and "3 days overdue" stays "3 days overdue" for every viewer.
// 3:00 PM on a Wednesday, a few days before daylight saving ends (Nov 1, 2026).
export const DEMO_NOW = "2026-10-28T15:00:00-04:00";

// The same moment as a UTC ISO string, which is how dates are stored in the demo state.
export const DEMO_NOW_ISO = new Date(DEMO_NOW).toISOString();

// Today's calendar date in West Lafayette.
export const DEMO_TODAY = "2026-10-28";
