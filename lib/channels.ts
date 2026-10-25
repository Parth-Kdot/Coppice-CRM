import { Channel } from "@/generated/prisma/enums";

// How an officer reached a company, in the order the log form lists them.
export const CHANNELS: Channel[] = Object.values(Channel);

export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  LINKEDIN: "LinkedIn",
  IN_PERSON: "In person",
  OTHER: "Other",
};
