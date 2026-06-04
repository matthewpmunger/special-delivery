import { describe, expect, it } from "vitest";
import { MatchRuntime } from "./match";
import { roleFor } from "./rooms";

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
});
