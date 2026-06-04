import type {
  BranchId,
  ClientSnapshot,
  MailType,
  ManifestCandidate,
  MatchEndPayload,
  PostageClass,
  RewardId,
  ShipRevealPayload,
  Stroke,
  WarmthBand,
  WarmthSummary
} from "./types";

export interface LobbyStatePayload {
  code: string;
  players: { id: string; nickname: string; branchId: BranchId; isBot: boolean; connected: boolean }[];
  branchNames: Record<BranchId, string>;
  canStart: boolean;
}

export interface RoundStartPayload {
  snapshot: ClientSnapshot;
  roles: Record<BranchId, { postmasterId: string; mailmanId: string }>;
  manifestCandidates?: ManifestCandidate[];
}

export interface ManifestResultPayload {
  agreed: boolean;
  word?: string;
  branchWords?: Partial<Record<BranchId, string>>;
  slot?: 1 | 2 | 3;
}

export interface GuessFeedbackPayload {
  result: "correct" | "close" | "wrong";
  warmth: WarmthBand;
}

export interface GuessMaskCell {
  kind: "correct" | "present" | "miss" | "space";
}

export interface GuessPublicPayload {
  playerId: string;
  playerName: string;
  label: "wrong" | "correct";
  text?: string;
  mask?: GuessMaskCell[];
}

export interface ChatEntryPayload {
  id: string;
  playerId?: string;
  playerName: string;
  text: string;
  encrypted?: boolean;
  ts: number;
}

export interface EmojiPayload {
  id: string;
  playerId: string;
  playerName: string;
  emojiId: string;
  bubbleId?: string;
  ts: number;
}

export interface BoundaryPromptPayload {
  promptId: string;
  kind: "postageClass" | "mailType";
  options: Array<{
    value: PostageClass | MailType;
    label: string;
    helper: string;
  }>;
  expiresAt: number;
}

export interface MarvPayload {
  type: "flow" | "countdown" | "chaos" | "result";
  text: string;
  scope: "match" | BranchId | "player";
}

export interface ScramblePiece {
  id: string;
  type: MailType;
  branchId: BranchId;
  assignedTo?: string;
  sortedBinId?: MailType;
}

export interface ScrambleStatePayload {
  pieces: ScramblePiece[];
  bins: Array<{ id: MailType; label: string }>;
  scores: Record<BranchId, number>;
  endsAt: number;
}

export interface ScrambleResultPayload {
  scores: Record<BranchId, number>;
  winner?: BranchId | "TIE";
  contributions: Record<string, number>;
}

export interface ServerToClientEvents {
  lobbyState: (payload: LobbyStatePayload) => void;
  state: (payload: ClientSnapshot) => void;
  roundStart: (payload: RoundStartPayload) => void;
  manifestResult: (payload: ManifestResultPayload) => void;
  strokeBroadcast: (payload: Stroke) => void;
  guessFeedback: (payload: GuessFeedbackPayload) => void;
  guessPublic: (payload: GuessPublicPayload) => void;
  warmth: (payload: { own?: WarmthBand; summary?: WarmthSummary }) => void;
  chatBroadcast: (payload: ChatEntryPayload) => void;
  emoji: (payload: EmojiPayload) => void;
  opponentScore: (payload: { branchId: BranchId; score: number }) => void;
  shipReveal: (payload: ShipRevealPayload) => void;
  boundaryPrompt: (payload: BoundaryPromptPayload) => void;
  marv: (payload: MarvPayload) => void;
  scrambleState: (payload: ScrambleStatePayload) => void;
  scrambleResult: (payload: ScrambleResultPayload) => void;
  matchEnd: (payload: MatchEndPayload) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  joinLobby: (payload: { code?: string; nickname: string; create?: boolean }) => void;
  resumeLobby: (payload: { code: string; playerId: string }) => void;
  startMatch: (payload: {
    cyclesTotal?: number;
    soloPlaytest?: boolean;
    soloScrambleTest?: boolean;
    soloRole?: "POSTMASTER" | "CREW" | "MAILMAN";
    drawGuessSeconds?: number;
  }) => void;
  rankManifest: (payload: { order: [string, string, string] }) => void;
  stroke: (payload: Stroke) => void;
  undo: (payload: Record<string, never>) => void;
  clear: (payload: Record<string, never>) => void;
  guess: (payload: { text: string }) => void;
  chat: (payload: { text: string }) => void;
  emojiMessage: (payload: { emojiId: string }) => void;
  emojiReact: (payload: { emojiId: string; bubbleId: string }) => void;
  ship: (payload: Record<string, never>) => void;
  chooseReward: (payload: { rewardId: RewardId }) => void;
  boundaryPick: (payload: { choice: PostageClass | MailType }) => void;
  scrambleSort: (payload: { pieceId: string; binId: MailType }) => void;
  vote: (payload: { when: "NOW" | "EOD" }) => void;
}
