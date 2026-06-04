import { describe, expect, it } from "vitest";
import { checkGuess, normalizeGuess } from "./guessing";

describe("guessing", () => {
  it("normalizes punctuation, spacing, plurals, variants, and aliases", () => {
    expect(normalizeGuess("  Hot-dog!! ")).toBe("hot dog");
    expect(checkGuess({ text: "hotdog", aliases: ["hot dog"] }, "hot dog").result).toBe("correct");
    expect(checkGuess({ text: "gray", aliases: [] }, "grey").result).toBe("correct");
    expect(checkGuess({ text: "bicycle", aliases: ["bike"] }, "bike").result).toBe("correct");
    expect(checkGuess({ text: "balloon", aliases: [] }, "balloons").result).toBe("correct");
  });

  it("gives close private warmth without accepting the guess", () => {
    const result = checkGuess({ text: "telescope", aliases: [] }, "telescop");
    expect(result.result).toBe("close");
    expect(result.warmth).toBe("HIGH");
  });
});
