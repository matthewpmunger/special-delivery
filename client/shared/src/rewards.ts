import { G, REWARD_MULTIPLIERS } from "./constants";
import type { Phase, RewardId } from "./types";

export function vmax(teamSize: number): number {
  const guessers = G(teamSize);
  return guessers <= 0 ? 0 : 1 + (guessers * (guessers - 1)) / 2;
}

export function rewardThresholds(teamSize: number): [number, number, number] {
  const max = vmax(teamSize);
  return REWARD_MULTIPLIERS.map((multiplier) => Math.ceil(max * multiplier)) as [number, number, number];
}

export function rewardTierForGap(gap: number, teamSize: number): 0 | 1 | 2 | 3 {
  const [t1, t2, t3] = rewardThresholds(teamSize);
  if (gap >= t3) return 3;
  if (gap >= t2) return 2;
  if (gap >= t1) return 1;
  return 0;
}

export function availableRewards(
  ownScore: number,
  opponentScore: number,
  teamSize: number,
  phase: Phase
): RewardId[] {
  const gap = opponentScore - ownScore;
  if (gap <= 0) return [];
  if (phase === "CLOSING") return ["DECRYPT"];

  const tier = rewardTierForGap(gap, teamSize);
  if (tier <= 0) return [];

  const rewards: RewardId[] = ["FORWARDING_ADDRESS"];
  if (tier >= 2) rewards.push("DECRYPT");
  if (tier >= 3) rewards.push("EXPRESS_MAIL", "POSTMARK_PEEK");
  return rewards;
}

export function canChooseReward(
  rewardId: RewardId,
  ownScore: number,
  opponentScore: number,
  teamSize: number,
  phase: Phase
): boolean {
  return availableRewards(ownScore, opponentScore, teamSize, phase).includes(rewardId);
}
