import { MAIL_TYPE_LABEL, SCRAMBLE } from "@special-delivery/shared";
import type { BranchId, MailType, Player } from "@special-delivery/shared";
import type { ScramblePiece, ScrambleResultPayload, ScrambleStatePayload } from "@special-delivery/shared/events";
import { randomItem } from "./manifest";

const MAIL_TYPES: MailType[] = ["POSTCARD", "GREETING_CARD", "PACKAGE", "TAKEOUT_MENU", "MAGAZINE", "NEWSPAPER"];

export interface ScrambleRuntime {
  pieces: ScramblePiece[];
  sorted: Set<string>;
  misses: Set<string>;
  scores: Record<BranchId, number>;
  contributions: Record<string, number>;
}

export function createScramble(players: Player[], endsAt: number, rng: () => number = Math.random): ScrambleRuntime {
  const pieces: ScramblePiece[] = [];
  for (const player of players) {
    for (let index = 0; index < SCRAMBLE.PIECES_PER_PLAYER; index += 1) {
      const type = randomItem(MAIL_TYPES, rng);
      pieces.push({
        id: `${player.id}-${index}`,
        type,
        branchId: player.branchId,
        assignedTo: player.id
      });
    }
  }
  return {
    pieces,
    sorted: new Set(),
    misses: new Set(),
    scores: { A: 0, B: 0 },
    contributions: {}
  };
}

export function scrambleState(runtime: ScrambleRuntime, endsAt: number): ScrambleStatePayload {
  return {
    pieces: runtime.pieces,
    bins: MAIL_TYPES.map((type) => ({ id: type, label: MAIL_TYPE_LABEL[type] })),
    scores: runtime.scores,
    endsAt
  };
}

export function sortPiece(
  runtime: ScrambleRuntime,
  player: Player,
  pieceId: string,
  binId: MailType
): { accepted: boolean; delta: number } {
  const piece = runtime.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || runtime.sorted.has(pieceId)) return { accepted: false, delta: 0 };
  const correct = piece.type === binId;
  const missKey = `${pieceId}:${binId}`;
  if (!correct && runtime.misses.has(missKey)) return { accepted: false, delta: 0 };
  if (correct) {
    runtime.sorted.add(pieceId);
    piece.sortedBinId = binId;
  } else {
    runtime.misses.add(missKey);
  }
  const delta = correct ? SCRAMBLE.CORRECT : SCRAMBLE.WRONG;
  runtime.scores[player.branchId] += delta;
  runtime.contributions[player.id] = (runtime.contributions[player.id] ?? 0) + delta;
  return { accepted: true, delta };
}

export function isScrambleComplete(runtime: ScrambleRuntime): boolean {
  return runtime.pieces.length > 0 && runtime.sorted.size >= runtime.pieces.length;
}

export function scrambleResult(runtime: ScrambleRuntime): ScrambleResultPayload {
  const winner =
    runtime.scores.A > runtime.scores.B ? "A" : runtime.scores.B > runtime.scores.A ? "B" : "TIE";
  return {
    scores: runtime.scores,
    winner,
    contributions: runtime.contributions
  };
}
