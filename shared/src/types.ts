export type BranchId = "A" | "B";

export type Phase =
  | "LOBBY"
  | "MANIFEST"
  | "DRAW_GUESS"
  | "SHIP_REVEAL"
  | "REVEAL_HOLD"
  | "SCRAMBLE"
  | "CLOSING"
  | "MATCH_END";

export type Role = "POSTMASTER" | "MAILMAN" | "CREW" | "INSPECTOR";
export type PostageClass = "STANDARD" | "FIRST_CLASS" | "PRIORITY";
export type MailType =
  | "POSTCARD"
  | "GREETING_CARD"
  | "PACKAGE"
  | "TAKEOUT_MENU"
  | "MAGAZINE"
  | "NEWSPAPER";
export type WarmthBand = "LOW" | "MEDIUM" | "HIGH" | "CORRECT";
export type RewardId =
  | "FORWARDING_ADDRESS"
  | "DECRYPT"
  | "EXPRESS_MAIL"
  | "POSTMARK_PEEK";

export interface Player {
  id: string;
  nickname: string;
  branchId: BranchId;
  isBot: boolean;
  connected: boolean;
}

export interface Stroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  op: "draw" | "erase" | "fill";
  image?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface Branch {
  id: BranchId;
  name: string;
  players: Player[];
  drawOrder: string[];
  postmasterId: string;
  mailmanId: string;
  ghostId?: string;
  score: number;
  roundsWon: number;
  scrambleScore: number;
  roundStrokeLog: Stroke[];
  warmthByPlayer: Record<string, WarmthBand>;
  previousWarmthBand: Record<string, WarmthBand>;
  correctGuessers: string[];
  shippedValue?: number;
  locked: boolean;
  activeReward?: RewardId;
  word?: string;
}

export interface Match {
  id: string;
  code: string;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  roundIndex: number;
  cycleIndex: number;
  cyclesTotal: number;
  postageClass: PostageClass;
  mailType: MailType;
  sharedWord?: string;
  branches: [Branch, Branch];
}

export type PhaseIntroKind = "ROUND_START" | "CLOSING_TIME" | "DRAW_START" | "SCRAMBLE_START";

export interface PhaseIntroPayload {
  id: string;
  kind: PhaseIntroKind;
  title: string;
  subtitle?: string;
  body: string;
  startsAt: number;
  endsAt: number;
}

export interface WordEntry {
  id: string;
  text: string;
  category: MailType;
  tier: PostageClass;
  aliases: string[];
}

export interface ManifestCandidate extends WordEntry {
  comfortSlot?: 1 | 2 | 3;
}

export interface WarmthSummary {
  correct: number;
  high: number;
  medium: number;
  low: number;
  warming: number;
  cooling: number;
}

export interface RoundRevealSide {
  branchId: BranchId;
  branchName: string;
  correctCount: number;
  eligibleGuessers: number;
  postageClass: PostageClass;
  stampValue: number;
  scoreBefore: number;
  scoreAfter: number;
  firstCorrectGuesser?: string;
  word: string;
  strokes: Stroke[];
}

export interface ShipRevealPayload {
  reason: "manual" | "sweep" | "timer";
  shippedBy?: BranchId;
  forceLockedBranch?: BranchId;
  forceLockCutOff: Partial<Record<BranchId, number>>;
  revealStartAt: number;
  sides: [RoundRevealSide, RoundRevealSide];
  roundWinner?: BranchId | "TIE";
  isClosingRound: boolean;
}

export interface StaffAward {
  playerId: string;
  playerName: string;
  title: string;
  detail: string;
}

export interface MatchEndPayload {
  winner?: BranchId | "TIE";
  reason: "POINTS" | "ROUNDS_WON" | "SCRAMBLE" | "TIE";
  finalScores: Record<BranchId, number>;
  roundsWon: Record<BranchId, number>;
  scrambleScores: Record<BranchId, number>;
  awards: StaffAward[];
}

export interface ClientSafeBranch {
  id: BranchId;
  name: string;
  players: Player[];
  postmasterId: string;
  mailmanId: string;
  score: number;
  roundsWon: number;
  scrambleScore: number;
  locked: boolean;
  correctGuessers: string[];
  warmthSummary?: WarmthSummary;
  ownWarmth?: WarmthBand;
  activeReward?: RewardId;
  roundStrokeLog?: Stroke[];
  word?: string;
  wordHint?: string;
  shippedValue?: number;
}

export interface ClientSnapshot {
  matchId: string;
  code: string;
  playerId: string;
  branchId: BranchId;
  role: Role;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  phaseIntro?: PhaseIntroPayload;
  roundIndex: number;
  cycleIndex: number;
  cyclesTotal: number;
  isClosingRound: boolean;
  postageClass: PostageClass;
  mailType: MailType;
  classTierLabel: string;
  ownBranch: ClientSafeBranch;
  opponent: Pick<ClientSafeBranch, "id" | "name" | "score" | "roundsWon" | "locked" | "shippedValue">;
  manifestCandidates?: ManifestCandidate[];
  reveal?: ShipRevealPayload;
}
