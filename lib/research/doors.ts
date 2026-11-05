// The kinds of door a research brief can point to. Shared by the server (the AI's schema) and the
// company page (labels), so it has no server imports.

export const DOORS = ["CAMPUS_RECRUITING", "UNIVERSITY_RELATIONS", "GIVING", "SPONSORSHIP", "ERG", "LOCAL_SITE", "OTHER"] as const;
export type Door = (typeof DOORS)[number];

export const DOOR_LABELS: Record<Door, string> = {
  CAMPUS_RECRUITING: "Campus recruiting",
  UNIVERSITY_RELATIONS: "University relations",
  GIVING: "Giving portal",
  SPONSORSHIP: "Sponsorship requests",
  ERG: "Employee resource group",
  LOCAL_SITE: "Local site",
  OTHER: "Other door",
};
