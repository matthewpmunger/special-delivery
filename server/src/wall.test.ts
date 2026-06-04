import { describe, expect, it } from "vitest";
import { createGuessMask, MatchRuntime, type RuntimeEvent } from "./match";
import { normalizeGuess } from "./guessing";
import { roleFor } from "./rooms";
import type { ManifestCandidate, ShipRevealPayload, Stroke } from "@special-delivery/shared";
import type { GuessPublicPayload } from "@special-delivery/shared/events";

describe("information wall", () => {
  it("marks present letters when a guess has correct characters in the wrong positions", () => {
    const mask = createGuessMask("plated", { text: "planet" }, false).map((cell) => cell.kind);

    expect(mask).toEqual(["correct", "correct", "correct", "present", "correct", "miss"]);
  });

  it("does not over-count present letters for duplicate characters", () => {
    const mask = createGuessMask("lalal", { text: "apple" }, false).map((cell) => cell.kind);

    expect(mask).toEqual(["present", "present", "miss", "miss", "miss"]);
  });

  it("gives manifest candidates and target words only to the Postmaster before reveal", () => {
    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({ code: "WALL", timerScale: 100, emit: (event) => events.push(event) });
    for (let index = 0; index < 8; index += 1) runtime.addPlayer(`Wall ${index + 1}`);
    runtime.startMatch(1);

    const postmasters = runtime.state.branches.map((branch) => branch.postmasterId);
    const aPostmaster = postmasters[0];
    const bPostmaster = postmasters[1];
    expect(aPostmaster).toBeDefined();
    expect(bPostmaster).toBeDefined();
    const candidates = (runtime.snapshotFor(aPostmaster as string).manifestCandidates ?? []) as ManifestCandidate[];
    expect(candidates).toHaveLength(3);
    expect(runtime.snapshotFor(runtime.state.branches[0].players.find((player) => roleFor(runtime.state, player.id) === "CREW")?.id ?? "").manifestCandidates).toBeUndefined();

    const order = candidates.map((candidate) => candidate.id) as [string, string, string];
    runtime.state.phaseStartedAt = Date.now() - 1;
    runtime.submitManifestRank(aPostmaster as string, order);
    runtime.submitManifestRank(bPostmaster as string, order);

    const crew = runtime.state.branches[0].players.find((player) => roleFor(runtime.state, player.id) === "CREW");
    expect(crew).toBeDefined();
    expect(runtime.snapshotFor(aPostmaster as string).ownBranch.word).toBeDefined();
    const crewSnapshot = runtime.snapshotFor(crew?.id ?? "");
    expect(crewSnapshot.ownBranch.word).toBeUndefined();
    expect(crewSnapshot.ownBranch.wordHint).toContain("_");

    runtime.dispose();
  });

  it("accepts a final stroke that started before the draw canvas locked", () => {
    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({ code: "LATE", timerScale: 100, emit: (event) => events.push(event) });
    for (let index = 0; index < 8; index += 1) runtime.addPlayer(`Late ${index + 1}`);
    runtime.startMatch(1);

    const aPostmaster = runtime.state.branches[0].postmasterId;
    const bPostmaster = runtime.state.branches[1].postmasterId;
    const bMailman = runtime.state.branches[1].mailmanId;
    const candidates = runtime.snapshotFor(aPostmaster).manifestCandidates ?? [];
    const order = candidates.map((candidate) => candidate.id) as [string, string, string];
    runtime.state.phaseStartedAt = Date.now() - 1;
    runtime.submitManifestRank(aPostmaster, order);
    runtime.submitManifestRank(bPostmaster, order);
    runtime.state.phaseStartedAt = Date.now() - 1;

    const startedAt = Date.now();
    runtime.ship(bMailman);
    const lateStroke: Stroke = {
      id: "late-final-stroke",
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 }
      ],
      color: "#c2473c",
      width: 5,
      op: "draw",
      startedAt,
      endedAt: Date.now()
    };
    runtime.submitStroke(aPostmaster, lateStroke);

    const revealEvents = events.filter((event) => event.event === "shipReveal");
    const latestReveal = revealEvents.at(-1)?.payload as ShipRevealPayload | undefined;
    expect(latestReveal?.sides.find((side) => side.branchId === "A")?.strokes.some((stroke) => stroke.id === lateStroke.id)).toBe(true);

    runtime.dispose();
  });

  it("shows a correct guess text only to the player who submitted it", () => {
    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({ code: "GUESS", timerScale: 100, emit: (event) => events.push(event) });
    for (let index = 0; index < 8; index += 1) runtime.addPlayer(`Guess ${index + 1}`);
    runtime.startMatch(1);

    const aPostmaster = runtime.state.branches[0].postmasterId;
    const bPostmaster = runtime.state.branches[1].postmasterId;
    const candidates = runtime.snapshotFor(aPostmaster).manifestCandidates ?? [];
    const order = candidates.map((candidate) => candidate.id) as [string, string, string];
    runtime.state.phaseStartedAt = Date.now() - 1;
    runtime.submitManifestRank(aPostmaster, order);
    runtime.submitManifestRank(bPostmaster, order);
    runtime.state.phaseStartedAt = Date.now() - 1;

    const branch = runtime.state.branches[0];
    const guesser = branch.players.find((player) => roleFor(runtime.state, player.id) === "CREW");
    const otherCrew = branch.players.find(
      (player) => player.id !== guesser?.id && roleFor(runtime.state, player.id) === "CREW"
    );
    const word = runtime.snapshotFor(aPostmaster).ownBranch.word;
    if (!guesser || !otherCrew || !word) throw new Error("Expected branch crew and a revealed Postmaster word");

    events.length = 0;
    runtime.submitGuess(guesser.id, word);

    const guessEvents = events.filter((event) => event.event === "guessPublic");
    const payloadFor = (playerId: string) =>
      guessEvents.find((event) => event.target.scope === "player" && event.target.playerId === playerId)
        ?.payload as GuessPublicPayload | undefined;
    const opponentCrew = runtime.state.branches[1].players.find((player) => roleFor(runtime.state, player.id) === "CREW");
    if (!opponentCrew) throw new Error("Expected opponent crew");

    expect(payloadFor(guesser.id)).toMatchObject({ label: "correct", text: word });
    expect(payloadFor(otherCrew.id)).toMatchObject({ label: "correct", text: undefined });
    expect(payloadFor(branch.mailmanId)).toMatchObject({ label: "correct", text: undefined });
    expect(payloadFor(branch.mailmanId)?.mask?.every((cell) => cell.kind === "correct" || cell.kind === "space")).toBe(true);
    const opponentCorrectMask = payloadFor(opponentCrew.id)?.mask ?? [];
    expect(opponentCorrectMask.filter((cell) => cell.kind !== "space")).toHaveLength([
      ...normalizeGuess(word).replace(/\s/g, "")
    ].length);
    expect(opponentCorrectMask.every((cell) => cell.kind === "correct" || cell.kind === "space")).toBe(true);

    runtime.dispose();
  });

  it("obfuscates opponent wrong guesses without changing guess length", () => {
    const events: RuntimeEvent[] = [];
    const runtime = new MatchRuntime({ code: "MASK", timerScale: 100, emit: (event) => events.push(event) });
    for (let index = 0; index < 8; index += 1) runtime.addPlayer(`Mask ${index + 1}`);
    runtime.startMatch(1);

    const aPostmaster = runtime.state.branches[0].postmasterId;
    const bPostmaster = runtime.state.branches[1].postmasterId;
    const candidates = runtime.snapshotFor(aPostmaster).manifestCandidates ?? [];
    const order = candidates.map((candidate) => candidate.id) as [string, string, string];
    runtime.state.phaseStartedAt = Date.now() - 1;
    runtime.submitManifestRank(aPostmaster, order);
    runtime.submitManifestRank(bPostmaster, order);
    runtime.state.phaseStartedAt = Date.now() - 1;

    const branch = runtime.state.branches[0];
    const wrongGuesser = branch.players.find((player) => roleFor(runtime.state, player.id) === "CREW");
    const sameBranchCrew = branch.players.find(
      (player) => player.id !== wrongGuesser?.id && roleFor(runtime.state, player.id) === "CREW"
    );
    const opponentCrew = runtime.state.branches[1].players.find((player) => roleFor(runtime.state, player.id) === "CREW");
    if (!wrongGuesser || !sameBranchCrew || !opponentCrew) throw new Error("Expected crew players");

    events.length = 0;
    runtime.submitGuess(wrongGuesser.id, "zzzz");

    const guessEvents = events.filter((event) => event.event === "guessPublic");
    const payloadFor = (playerId: string) =>
      guessEvents.find((event) => event.target.scope === "player" && event.target.playerId === playerId)
        ?.payload as GuessPublicPayload | undefined;

    expect(payloadFor(sameBranchCrew.id)).toMatchObject({ label: "wrong", text: "zzzz" });
    const mailmanMask = payloadFor(branch.mailmanId)?.mask ?? [];
    expect(mailmanMask).toHaveLength(4);
    expect(mailmanMask.every((cell) => ["correct", "present", "miss"].includes(cell.kind))).toBe(true);
    const opponentMask = payloadFor(opponentCrew.id)?.mask ?? [];
    expect(opponentMask).toHaveLength(4);
    expect(opponentMask.every((cell) => ["correct", "present", "miss"].includes(cell.kind))).toBe(true);

    runtime.dispose();
  });
});
