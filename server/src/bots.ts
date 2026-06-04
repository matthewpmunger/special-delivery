import { nanoid } from "nanoid";
import type { BranchId, Player, PostageClass, RewardId } from "@special-delivery/shared";
import type { ManifestCandidate, MailType } from "@special-delivery/shared";
import { randomItem, shuffle } from "./manifest";

export function makeBot(branchId: BranchId, index: number): Player {
  return {
    id: `bot-${branchId}-${index}-${nanoid(5)}`,
    nickname: `MARVbot ${branchId}${index + 1}`,
    branchId,
    isBot: true,
    connected: true
  };
}

export function botManifestOrder(candidates: ManifestCandidate[], rng: () => number = Math.random): [string, string, string] {
  return shuffle(candidates, rng).map((candidate) => candidate.id) as [string, string, string];
}

export function botBoundaryPick<T extends PostageClass | MailType>(options: readonly T[], rng: () => number = Math.random): T {
  return randomItem(options, rng);
}

export function botRewardPick(options: readonly RewardId[], rng: () => number = Math.random): RewardId | undefined {
  return options.length ? randomItem(options, rng) : undefined;
}

export function sampledCorrectTime(drawDurationMs: number, rng: () => number = Math.random): number {
  const floor = drawDurationMs * 0.18;
  const ceiling = drawDurationMs * 0.92;
  return Math.round(floor + (ceiling - floor) * rng());
}
