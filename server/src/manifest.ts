import { WORDS } from "@special-delivery/shared/words";
import type { BranchId, MailType, ManifestCandidate, PostageClass, WordEntry } from "@special-delivery/shared";

export interface ManifestResolution {
  agreed: boolean;
  slot?: 1 | 2 | 3;
  sharedWord?: WordEntry;
  branchWords: Record<BranchId, WordEntry>;
  timedOut: BranchId[];
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const item = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = item;
  }
  return copy;
}

export function randomItem<T>(items: readonly T[], rng: () => number = Math.random): T {
  if (!items.length) throw new Error("Cannot choose from an empty list");
  return items[Math.floor(rng() * items.length)] as T;
}

export function selectManifestCandidates(
  mailType: MailType,
  postageClass: PostageClass,
  rng: () => number = Math.random
): ManifestCandidate[] {
  const pool = WORDS.filter((word) => word.category === mailType && word.tier === postageClass);
  if (pool.length < 3) {
    throw new Error(`Need at least three words for ${mailType}/${postageClass}`);
  }
  return shuffle(pool, rng)
    .slice(0, 3)
    .map((word, index) => ({ ...word, comfortSlot: (index + 1) as 1 | 2 | 3 }));
}

function sanitizeRanking(candidateIds: Set<string>, order?: readonly string[]): [string, string, string] | undefined {
  if (!order || order.length !== 3) return undefined;
  const unique = [...new Set(order)];
  if (unique.length !== 3) return undefined;
  if (unique.some((id) => !candidateIds.has(id))) return undefined;
  return unique as [string, string, string];
}

export function resolveManifest(
  candidates: readonly ManifestCandidate[],
  rankings: Partial<Record<BranchId, readonly string[]>>,
  rng: () => number = Math.random
): ManifestResolution {
  if (candidates.length !== 3) throw new Error("Manifest resolution requires exactly three candidates");
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidateIds = new Set(byId.keys());
  const aOrder = sanitizeRanking(candidateIds, rankings.A);
  const bOrder = sanitizeRanking(candidateIds, rankings.B);
  const timedOut: BranchId[] = [];

  if (!aOrder) timedOut.push("A");
  if (!bOrder) timedOut.push("B");

  if (aOrder && bOrder) {
    for (let index = 0; index < 3; index += 1) {
      if (aOrder[index] === bOrder[index]) {
        const sharedWord = byId.get(aOrder[index] as string) as WordEntry;
        return {
          agreed: true,
          slot: (index + 1) as 1 | 2 | 3,
          sharedWord,
          branchWords: { A: sharedWord, B: sharedWord },
          timedOut
        };
      }
    }

    return {
      agreed: false,
      branchWords: {
        A: byId.get(aOrder[2]) as WordEntry,
        B: byId.get(bOrder[2]) as WordEntry
      },
      timedOut
    };
  }

  const fallback = (order?: [string, string, string]) =>
    order ? (byId.get(order[2]) as WordEntry) : randomItem(candidates, rng);

  return {
    agreed: false,
    branchWords: {
      A: fallback(aOrder),
      B: fallback(bOrder)
    },
    timedOut
  };
}
