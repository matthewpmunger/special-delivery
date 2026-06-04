import { describe, expect, it } from "vitest";
import { resolveMatchWinner, rewardThresholds, stampValue } from "./scoring";
import type { Match } from "@special-delivery/shared";

describe("scoring", () => {
  it("caps stamp value at G and doubles Closing Time", () => {
    expect(stampValue("FIRST_CLASS", 0, 8)).toBe(0);
    expect(stampValue("FIRST_CLASS", 6, 8)).toBe(16);
    expect(stampValue("FIRST_CLASS", 9, 8)).toBe(16);
    expect(stampValue("PRIORITY", 3, 8, true)).toBe(12);
  });

  it("uses reward thresholds from Vmax", () => {
    expect(rewardThresholds(8)).toEqual([24, 48, 96]);
  });

  it("settles match ties by rounds won then scramble", () => {
    const match = {
      branches: [
        { id: "A", score: 10, roundsWon: 2, scrambleScore: 0 },
        { id: "B", score: 10, roundsWon: 1, scrambleScore: 10 }
      ]
    } as Match;
    expect(resolveMatchWinner(match)).toEqual({ winner: "A", reason: "ROUNDS_WON" });
  });
});
