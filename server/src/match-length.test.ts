import { describe, expect, it } from "vitest";
import type { Player, Role } from "@special-delivery/shared";
import { MatchRuntime } from "./match";
import { roleFor } from "./rooms";

describe("match length", () => {
  it("schedules a halftime scramble during a one-cycle 14-player match", () => {
    const runtime = new MatchRuntime({ code: "MID", timerScale: 100 });

    for (let index = 0; index < 14; index += 1) {
      runtime.addPlayer(`Live ${index + 1}`);
    }

    runtime.startMatch(1);
    const shouldRunScrambleBefore = (
      runtime as unknown as { shouldRunScrambleBefore: (nextRoundIndex: number) => boolean }
    ).shouldRunScrambleBefore.bind(runtime);

    expect(runtime.state.branches.map((branch) => branch.players.length)).toEqual([7, 7]);
    expect(shouldRunScrambleBefore(2)).toBe(false);
    expect(shouldRunScrambleBefore(3)).toBe(true);
    expect(shouldRunScrambleBefore(4)).toBe(false);

    runtime.dispose();
  });

  it("runs three full role cycles when three rounds are selected", () => {
    const runtime = new MatchRuntime({ code: "LEN", timerScale: 100 });
    const players: Player[] = [];
    const forceStartRound = (runtime as unknown as { startRound: () => void }).startRound.bind(runtime);

    for (let index = 0; index < 8; index += 1) {
      players.push(runtime.addPlayer(`Player ${index + 1}`));
    }

    const branchPlayers = players.filter((player) => player.branchId === "A");
    const roleCounts = new Map<string, Record<Role, number>>();
    for (const player of branchPlayers) {
      roleCounts.set(player.id, { POSTMASTER: 0, MAILMAN: 0, CREW: 0, INSPECTOR: 0 });
    }

    runtime.startMatch(3);
    for (let roundIndex = 0; roundIndex < 12; roundIndex += 1) {
      if (roundIndex > 0) {
        runtime.state.roundIndex = roundIndex;
        forceStartRound();
      }
      for (const player of branchPlayers) {
        roleCounts.get(player.id)![roleFor(runtime.state, player.id)] += 1;
      }
    }

    expect(runtime.state.cyclesTotal).toBe(3);
    for (const counts of roleCounts.values()) {
      expect(counts.POSTMASTER).toBe(3);
      expect(counts.MAILMAN).toBe(3);
      expect(counts.CREW).toBe(6);
    }

    runtime.dispose();
  });
});
