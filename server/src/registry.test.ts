import { describe, expect, it } from "vitest";
import { MatchRegistry } from "./match";

describe("match registry sessions", () => {
  it("resumes an existing player seat by room code and player id", () => {
    const registry = new MatchRegistry({ timerScale: 100 });
    const joined = registry.create("Route Tester");
    const initialPlayerCount = joined.match.state.branches.flatMap((branch) => branch.players).length;

    joined.match.disconnectPlayer(joined.player.id);
    const resumed = registry.resume(joined.match.state.code, joined.player.id);

    expect(resumed?.player.id).toBe(joined.player.id);
    expect(resumed?.match.state.code).toBe(joined.match.state.code);
    expect(joined.match.state.branches.flatMap((branch) => branch.players)).toHaveLength(initialPlayerCount);
    expect(registry.resume("WRONG999", joined.player.id)).toBeUndefined();

    joined.match.dispose();
  });
});
