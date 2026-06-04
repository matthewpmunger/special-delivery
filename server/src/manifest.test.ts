import { describe, expect, it } from "vitest";
import type { ManifestCandidate } from "@special-delivery/shared";
import { resolveManifest } from "./manifest";

const candidates: ManifestCandidate[] = [
  { id: "a", text: "apple", category: "TAKEOUT_MENU", tier: "STANDARD", aliases: [] },
  { id: "b", text: "banana", category: "TAKEOUT_MENU", tier: "STANDARD", aliases: [] },
  { id: "c", text: "carrot", category: "TAKEOUT_MENU", tier: "STANDARD", aliases: [] }
];

describe("manifest", () => {
  it("commits to the highest matching slot", () => {
    const result = resolveManifest(candidates, { A: ["a", "b", "c"], B: ["c", "b", "a"] });
    expect(result.agreed).toBe(true);
    expect(result.slot).toBe(2);
    expect(result.sharedWord?.id).toBe("b");
  });

  it("diverges to each branch's least comfortable candidate when no slots match", () => {
    const result = resolveManifest(candidates, { A: ["a", "b", "c"], B: ["b", "c", "a"] });
    expect(result.agreed).toBe(false);
    expect(result.branchWords.A.id).toBe("c");
    expect(result.branchWords.B.id).toBe("a");
  });
});
