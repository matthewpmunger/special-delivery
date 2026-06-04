import { CLASS_TIER_LABEL, G } from "@special-delivery/shared";
import type {
  Branch,
  BranchId,
  ClientSafeBranch,
  ClientSnapshot,
  ManifestCandidate,
  Match,
  Player,
  PhaseIntroPayload,
  Role,
  ShipRevealPayload
} from "@special-delivery/shared";
import { summarizeWarmth } from "./guessing";

export function branchRoom(matchId: string, branchId: BranchId): string {
  return `match:${matchId}:${branchId}`;
}

export function matchRoom(matchId: string): string {
  return `match:${matchId}`;
}

export function getBranch(match: Match, branchId: BranchId): Branch {
  return match.branches.find((branch) => branch.id === branchId) ?? match.branches[0];
}

export function otherBranchId(branchId: BranchId): BranchId {
  return branchId === "A" ? "B" : "A";
}

export function findPlayer(match: Match, playerId: string): Player | undefined {
  return match.branches.flatMap((branch) => branch.players).find((player) => player.id === playerId);
}

export function roleFor(match: Match, playerId: string): Role {
  const branch = match.branches.find((candidate) => candidate.players.some((player) => player.id === playerId));
  if (!branch) return "CREW";
  if (branch.ghostId === playerId) return "INSPECTOR";
  if (branch.postmasterId === playerId) return "POSTMASTER";
  if (branch.mailmanId === playerId) return "MAILMAN";
  return "CREW";
}

export function eligibleCrewIds(branch: Branch): string[] {
  return branch.players
    .filter((player) => player.id !== branch.postmasterId && player.id !== branch.mailmanId && player.id !== branch.ghostId)
    .map((player) => player.id)
    .slice(0, G(branch.players.length));
}

const WORD_HINT_REVEAL_START = 0.2;
const WORD_HINT_REVEAL_END = 0.9;

function safeBranch(branch: Branch, role: Role, playerId: string, includeWord: boolean, wordHint?: string): ClientSafeBranch {
  const eligible = eligibleCrewIds(branch);
  return {
    id: branch.id,
    name: branch.name,
    players: branch.players,
    postmasterId: branch.postmasterId,
    mailmanId: branch.mailmanId,
    score: branch.score,
    roundsWon: branch.roundsWon,
    scrambleScore: branch.scrambleScore,
    locked: branch.locked,
    correctGuessers: branch.correctGuessers,
    activeReward: undefined,
    warmthSummary: role === "MAILMAN" ? summarizeWarmth(branch.warmthByPlayer, branch.previousWarmthBand, eligible) : undefined,
    ownWarmth: role === "CREW" ? branch.warmthByPlayer[playerId] ?? "LOW" : undefined,
    roundStrokeLog: role === "POSTMASTER" || role === "INSPECTOR" || role === "CREW" ? branch.roundStrokeLog : undefined,
    word: includeWord ? branch.word : undefined,
    wordHint,
    shippedValue: branch.shippedValue
  };
}

export function createSnapshot(
  match: Match,
  playerId: string,
  manifestCandidates?: ManifestCandidate[],
  reveal?: ShipRevealPayload,
  phaseIntro?: PhaseIntroPayload
): ClientSnapshot {
  const player = findPlayer(match, playerId) ?? match.branches[0].players[0];
  if (!player) throw new Error("Cannot create snapshot without a player");
  const role = roleFor(match, playerId);
  const ownBranch = getBranch(match, player.branchId);
  const opponent = getBranch(match, otherBranchId(player.branchId));
  const postmasterCanKnowWord = role === "POSTMASTER" && (match.phase === "DRAW_GUESS" || match.phase === "SHIP_REVEAL");
  const inspectorCanSeeWord = role === "INSPECTOR" && match.phase === "SHIP_REVEAL";
  const includeOwnWord = postmasterCanKnowWord || inspectorCanSeeWord;
  const wordHint = match.phase === "DRAW_GUESS" ? createWordHint(ownBranch.word, match, ownBranch.id) : undefined;

  return {
    matchId: match.id,
    code: match.code,
    playerId,
    branchId: player.branchId,
    role,
    phase: match.phase,
    phaseStartedAt: match.phaseStartedAt,
    phaseEndsAt: match.phaseEndsAt,
    phaseIntro,
    roundIndex: match.roundIndex,
    cycleIndex: match.cycleIndex,
    cyclesTotal: match.cyclesTotal,
    isClosingRound: match.roundIndex >= Math.max(1, match.cyclesTotal * Math.min(match.branches[0].players.length, match.branches[1].players.length)) - 1,
    postageClass: match.postageClass,
    mailType: match.mailType,
    classTierLabel: CLASS_TIER_LABEL[match.postageClass],
    ownBranch: safeBranch(ownBranch, role, playerId, includeOwnWord, includeOwnWord ? undefined : wordHint),
    opponent: {
      id: opponent.id,
      name: opponent.name,
      score: opponent.score,
      roundsWon: opponent.roundsWon,
      locked: opponent.locked,
      shippedValue: opponent.shippedValue
    },
    manifestCandidates: role === "POSTMASTER" && match.phase === "MANIFEST" ? manifestCandidates : undefined,
    reveal
  };
}

function createWordHint(word: string | undefined, match: Match, branchId: BranchId): string | undefined {
  if (!word) return undefined;
  const letterIndexes = [...word].flatMap((character, index) => (isHintLetter(character) ? [index] : []));
  if (!letterIndexes.length) return word.toUpperCase();

  const duration = Math.max(1, match.phaseEndsAt - match.phaseStartedAt);
  const elapsed = Math.max(0, Math.min(duration, Date.now() - match.phaseStartedAt));
  const revealStart = duration * WORD_HINT_REVEAL_START;
  const revealEnd = duration * WORD_HINT_REVEAL_END;
  const progress = elapsed < revealStart ? 0 : Math.min(1, (elapsed - revealStart) / Math.max(1, revealEnd - revealStart));
  const revealCount = progress <= 0 ? 0 : Math.max(1, Math.ceil(progress * letterIndexes.length));
  const revealIndexes = new Set(shuffledLetterIndexes(letterIndexes, `${match.id}:${match.roundIndex}:${branchId}:${word}`).slice(0, revealCount));

  return [...word]
    .map((character, index) => {
      if (!isHintLetter(character)) return character;
      return revealIndexes.has(index) ? character.toUpperCase() : "_";
    })
    .join("");
}

function isHintLetter(character: string): boolean {
  return /^[A-Za-z0-9]$/.test(character);
}

function shuffledLetterIndexes(indexes: number[], seedInput: string): number[] {
  const shuffled = [...indexes];
  const random = seededRandom(hashString(seedInput));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex] as number, shuffled[index] as number];
  }
  return shuffled;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
