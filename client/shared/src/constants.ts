import type { MailType, PostageClass, RewardId } from "./types";

export const G = (teamSize: number) => Math.max(0, teamSize - 2);

export const TIMERS = {
  ROUND_BRIEFING: 10_000,
  CLOSING_BRIEFING: 10_000,
  MANIFEST: 10_000,
  DRAW_BRIEFING: 10_000,
  DRAW_GUESS_DEFAULT: 45_000,
  REVEAL_HOLD_FLOOR: 5_000,
  REVEAL_HOLD_CAP: 15_000,
  SCRAMBLE_BRIEFING: 10_000,
  SCRAMBLE: 30_000,
  SCRAMBLE_RESULT: 5_000,
  DISCONNECT_GRACE: 10_000
} as const;

export const CURVES: Record<PostageClass, number[]> = {
  STANDARD: [1, 2, 3, 4, 5, 6],
  FIRST_CLASS: [1, 2, 4, 7, 11, 16],
  PRIORITY: [2, 4, 6, 8, 10, 11]
};

export const CLASS_TIER_LABEL: Record<PostageClass, string> = {
  STANDARD: "Easy words",
  PRIORITY: "Trickier words",
  FIRST_CLASS: "Hard words"
};

export const CLOSING_TIME_MULTIPLIER = 2;
export const REWARD_MULTIPLIERS = [1.5, 3, 6] as const;

export const SCRAMBLE = {
  PIECES_PER_PLAYER: 4,
  CORRECT: 1,
  WRONG: -1
} as const;

export const MAIL_TYPE_LABEL: Record<MailType, string> = {
  POSTCARD: "Postcard",
  GREETING_CARD: "Greeting card",
  PACKAGE: "Package",
  TAKEOUT_MENU: "Takeout menu",
  MAGAZINE: "Magazine",
  NEWSPAPER: "Newspaper"
};

export const MAIL_TYPE_CATEGORY: Record<MailType, string> = {
  POSTCARD: "Places",
  GREETING_CARD: "Occasions",
  PACKAGE: "Objects",
  TAKEOUT_MENU: "Food",
  MAGAZINE: "Interests",
  NEWSPAPER: "Events"
};

export const MAIL_TYPE_RATIO: Record<MailType, { width: number; height: number }> = {
  POSTCARD: { width: 7, height: 5 },
  GREETING_CARD: { width: 5, height: 7 },
  PACKAGE: { width: 1, height: 1 },
  TAKEOUT_MENU: { width: 9, height: 16 },
  MAGAZINE: { width: 7, height: 9 },
  NEWSPAPER: { width: 4, height: 3 }
};

export const REWARD_LABEL: Record<RewardId, string> = {
  FORWARDING_ADDRESS: "Forwarding Address",
  DECRYPT: "Decrypt",
  EXPRESS_MAIL: "Express Mail",
  POSTMARK_PEEK: "Postmark Peek"
};

export const BRANCH_NAMES = [
  "North Loop Branch",
  "Juniper Station",
  "Red Stamp Office",
  "Parcel Point",
  "Blue Route Branch",
  "Cedar Sort House"
] as const;

export const EMOJI_IDS = ["stamp", "eyes", "spark", "panic", "hold", "ship"] as const;
