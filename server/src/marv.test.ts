import { describe, expect, it } from "vitest";
import { MatchRuntime, type RuntimeEvent } from "./match";

describe("MARV narration", () => {
  it("introduces MARV and the scanner mishap when a match starts", () => {
    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({ code: "MARV", timerScale: 100, emit: (event) => events.push(event) });

    runtime.addPlayer("Route Tester");
    runtime.startMatch(1);

    const marvMessages = events
      .filter((event) => event.event === "marv")
      .map((event) => (event.payload as { text: string }).text);

    expect(marvMessages.slice(0, 3)).toEqual([
      expect.stringContaining("Mail Automation and Routing Valet"),
      expect.stringContaining("stripped it blank"),
      expect.stringContaining("sorting floor")
    ]);

    runtime.dispose();
  });
});
