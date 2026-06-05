import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchRuntime } from "./match";
import { roleFor } from "./rooms";
import type { RuntimeEvent } from "./match";
import type { ScrambleResultPayload } from "@special-delivery/shared/events";

afterEach(() => {
  vi.useRealTimers();
});

describe("solo playtest", () => {
  it("cycles one human through the playable branch roles", () => {
    const runtime = new MatchRuntime({ code: "SOLO", timerScale: 100 });
    const human = runtime.addPlayer("Solo tester");
    const forceStartRound = (runtime as unknown as { startRound: () => void }).startRound.bind(runtime);

    runtime.enableSoloPlaytest(human.id);
    runtime.startMatch(1);
    expect(roleFor(runtime.state, human.id)).toBe("POSTMASTER");
    expect(runtime.state.branches[0].players.filter((player) => player.isBot)).toHaveLength(3);
    expect(runtime.state.branches[1].players.every((player) => player.isBot)).toBe(true);

    runtime.state.roundIndex = 1;
    forceStartRound();
    expect(roleFor(runtime.state, human.id)).toBe("CREW");

    runtime.state.roundIndex = 2;
    forceStartRound();
    expect(roleFor(runtime.state, human.id)).toBe("MAILMAN");

    runtime.dispose();
  });

  it("paces solo scramble bot drops so the player has time to react", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({
      autoStartMinPerBranch: 4,
      code: "PACE",
      emit: (event) => events.push(event),
      rng: () => 0.5
    });
    const human = runtime.addPlayer("Scramble tester");
    runtime.startSoloScrambleTest(human.id, 30);

    expect(events.filter((event) => event.event === "scrambleState")).toHaveLength(1);

    vi.advanceTimersByTime(13_500);
    expect(events.filter((event) => event.event === "scrambleState")).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(events.filter((event) => event.event === "scrambleState").length).toBeGreaterThan(1);

    runtime.dispose();
  });

  it.each([
    { label: "solo team win", rngValue: 0.1, expectedWinner: "A" },
    { label: "other team win", rngValue: 0.5, expectedWinner: "B" },
    { label: "tie", rngValue: 0.9, expectedWinner: "TIE" }
  ] as const)("can simulate a $label scramble result", ({ rngValue, expectedWinner }) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({
      autoStartMinPerBranch: 4,
      code: "OUTCOME",
      emit: (event) => events.push(event),
      rng: () => rngValue
    });
    const human = runtime.addPlayer("Scramble tester");
    runtime.startSoloScrambleTest(human.id, 30);

    vi.advanceTimersByTime(45_000);

    const result = events.find((event) => event.event === "scrambleResult")?.payload as ScrambleResultPayload | undefined;
    expect(result?.winner).toBe(expectedWinner);
    if (expectedWinner === "A") expect(result?.scores.A).toBeGreaterThan(result?.scores.B ?? 0);
    if (expectedWinner === "B") expect(result?.scores.B).toBeGreaterThan(result?.scores.A ?? 0);
    if (expectedWinner === "TIE") expect(result?.scores.A).toBe(result?.scores.B);

    runtime.dispose();
  });
});
