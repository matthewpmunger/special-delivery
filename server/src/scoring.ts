import { CLOSING_TIME_MULTIPLIER, CURVES, G } from "@special-delivery/shared";
import type { Branch, BranchId, Match, PostageClass } from "@special-delivery/shared";
export { rewardThresholds, rewardTierForGap, vmax } from "@special-delivery/shared";

export function stampValue(
  postageClass: PostageClass,
  correctCount: number,
  teamSize: number,
  isClosingRound = false
): number {
  if (correctCount <= 0) return 0;
  const cap = G(teamSize);
  const n = Math.min(correctCount, cap, CURVES[postageClass].length);
  const base = CURVES[postageClass][n - 1] ?? 0;
  return isClosingRound ? base * CLOSING_TIME_MULTIPLIER : base;
}

export function branchRoundValue(branch: Branch, postageClass: PostageClass, isClosingRound = false): number {
  return stampValue(postageClass, branch.correctGuessers.length, branch.players.length, isClosingRound);
}

export function roundWinner(aValue: number, bValue: number): BranchId | "TIE" {
  if (aValue > bValue) return "A";
  if (bValue > aValue) return "B";
  return "TIE";
}

export function resolveMatchWinner(match: Match): {
  winner?: BranchId | "TIE";
  reason: "POINTS" | "ROUNDS_WON" | "SCRAMBLE" | "TIE";
} {
  const [a, b] = match.branches;
  if (a.score > b.score) return { winner: "A", reason: "POINTS" };
  if (b.score > a.score) return { winner: "B", reason: "POINTS" };
  if (a.roundsWon > b.roundsWon) return { winner: "A", reason: "ROUNDS_WON" };
  if (b.roundsWon > a.roundsWon) return { winner: "B", reason: "ROUNDS_WON" };
  if (a.scrambleScore > b.scrambleScore) return { winner: "A", reason: "SCRAMBLE" };
  if (b.scrambleScore > a.scrambleScore) return { winner: "B", reason: "SCRAMBLE" };
  return { winner: "TIE", reason: "TIE" };
}
