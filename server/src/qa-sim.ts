import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TIMERS, type BranchId, type Player, type Role, type Stroke } from "@special-delivery/shared";
import type { BoundaryPromptPayload, GuessPublicPayload, ScrambleStatePayload } from "@special-delivery/shared/events";
import { MatchRuntime, type RuntimeEvent } from "./match";

type SoloRole = "POSTMASTER" | "CREW" | "MAILMAN";

function seeded(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function activate(runtime: MatchRuntime, durationMs = 60_000): void {
  runtime.state.phaseStartedAt = Date.now() - 10;
  runtime.state.phaseEndsAt = Date.now() + durationMs;
  (runtime as unknown as { phaseIntro?: unknown }).phaseIntro = undefined;
}

function eventsOf(events: RuntimeEvent[], event: RuntimeEvent["event"]): RuntimeEvent[] {
  return events.filter((entry) => entry.event === event);
}

function roleFor(runtime: MatchRuntime, player: Player): Role {
  const branch = runtime.state.branches.find((candidate) => candidate.id === player.branchId);
  if (!branch) return "CREW";
  if (branch.postmasterId === player.id) return "POSTMASTER";
  if (branch.mailmanId === player.id) return "MAILMAN";
  return "CREW";
}

function playerWithRole(runtime: MatchRuntime, branchId: BranchId, role: SoloRole, human = false): Player {
  const branch = runtime.state.branches.find((candidate) => candidate.id === branchId);
  assert(branch, `Expected branch ${branchId}`);
  const player = branch.players.find((candidate) => {
    const candidateRole = roleFor(runtime, candidate);
    return candidateRole === role && (!human || !candidate.isBot);
  });
  assert(player, `Expected ${human ? "human " : ""}${role} on branch ${branchId}`);
  return player;
}

function manifestOrder(runtime: MatchRuntime): [string, string, string] {
  const candidates = (runtime as unknown as { manifestCandidates: Array<{ id: string }> }).manifestCandidates;
  assert.equal(candidates.length, 3, "Manifest should have three candidates");
  return [candidates[0]!.id, candidates[1]!.id, candidates[2]!.id];
}

function currentWord(runtime: MatchRuntime, branchId: BranchId): string {
  const words = (runtime as unknown as { currentWords: Partial<Record<BranchId, { text: string }>> }).currentWords;
  const word = words[branchId]?.text ?? runtime.state.branches.find((branch) => branch.id === branchId)?.word;
  assert(word, `Expected active word for branch ${branchId}`);
  return word;
}

function driveToDraw(runtime: MatchRuntime, seconds = 45): void {
  runtime.startMatch(1, seconds);
  activate(runtime);
  const order = manifestOrder(runtime);
  for (const branch of runtime.state.branches) runtime.submitManifestRank(branch.postmasterId, order);
  activate(runtime);
  assert.equal(runtime.state.phase, "DRAW_GUESS");
}

function makeStroke(startOffset = -100, endOffset = 0): Stroke {
  const now = Date.now();
  return {
    id: randomUUID(),
    color: "#c2473c",
    op: "draw",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 }
    ],
    startedAt: now + startOffset,
    endedAt: now + endOffset,
    width: 8
  };
}

function runScenario(name: string, test: () => void): void {
  test();
  console.log(`ok - ${name}`);
}

runScenario("solo fixtures can start on each role", () => {
  const roles: SoloRole[] = ["POSTMASTER", "CREW", "MAILMAN"];
  for (const startRole of roles) {
    const runtime = new MatchRuntime({ autoStartMinPerBranch: 4, rng: seeded(startRole.length), timerScale: 0.001 });
    const human = runtime.addPlayer(`QA ${startRole}`);
    runtime.enableSoloPlaytest(human.id, startRole);
    runtime.startMatch(1, 30);
    activate(runtime);
    assert.equal(roleFor(runtime, human), startRole);
    runtime.dispose();
  }
});

runScenario("solo scramble test starts directly in scramble", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 4,
    emit: (event) => events.push(event),
    rng: seeded(8),
    timerScale: 0.001
  });
  const human = runtime.addPlayer("Scramble QA");
  runtime.startSoloScrambleTest(human.id, 30);
  assert.equal(runtime.state.phase, "SCRAMBLE");
  const scrambleEvent = eventsOf(events, "scrambleState")[0];
  assert(scrambleEvent, "Expected scramble state event");
  const stateEvent = eventsOf(events, "state").find((event) => event.target.scope === "player" && event.target.playerId === human.id);
  assert.equal(stateEvent && (stateEvent.payload as { phase: string }).phase, "SCRAMBLE");
  const payload = scrambleEvent.payload as ScrambleStatePayload;
  assert(payload.pieces.length > 0, "Scramble should include sortable pieces");
  assert(payload.bins.length > 0, "Scramble should include bins");
  activate(runtime);
  const piece = payload.pieces.find((candidate) => candidate.assignedTo);
  assert(piece?.assignedTo, "Expected a scramble piece assigned to a player");
  const wrongBin = payload.bins.find((bin) => bin.id !== piece.type);
  assert(wrongBin, "Expected a non-matching bin for a miss");
  runtime.scrambleSort(piece.assignedTo, piece.id, wrongBin.id);
  const afterWrong = eventsOf(events, "scrambleState").at(-1)?.payload as ScrambleStatePayload | undefined;
  assert.equal(
    afterWrong?.pieces.find((candidate) => candidate.id === piece.id)?.sortedBinId,
    undefined,
    "Wrong scramble drops should leave the piece unresolved"
  );
  runtime.scrambleSort(piece.assignedTo, piece.id, piece.type);
  const afterCorrect = eventsOf(events, "scrambleState").at(-1)?.payload as ScrambleStatePayload | undefined;
  assert.equal(
    afterCorrect?.pieces.find((candidate) => candidate.id === piece.id)?.sortedBinId,
    piece.type,
    "Correct scramble drops should mark the destination bin"
  );
  runtime.dispose();
});

runScenario("scramble ends immediately when every piece is sorted", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 4,
    emit: (event) => events.push(event),
    rng: seeded(9)
  });
  const human = runtime.addPlayer("Fast Sort QA");
  runtime.startSoloScrambleTest(human.id, 30);
  activate(runtime);
  const payload = eventsOf(events, "scrambleState")[0]?.payload as ScrambleStatePayload | undefined;
  assert(payload, "Expected scramble state event");
  const startRoundIndex = runtime.state.roundIndex;
  for (const piece of payload.pieces) {
    assert(piece.assignedTo, "Expected every scramble piece to be assigned");
    runtime.scrambleSort(piece.assignedTo, piece.id, piece.type);
  }
  assert.equal(eventsOf(events, "scrambleResult").length, 1, "Sorting every piece should end the scramble immediately");
  assert.equal(runtime.state.roundIndex, startRoundIndex, "Result hold should keep the next round from starting immediately");
  assert(runtime.state.phaseEndsAt - Date.now() <= TIMERS.SCRAMBLE_RESULT, "Scramble result hold should use the result timer");
  runtime.dispose();
});

runScenario("human mailman receives and can answer boundary prompts", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 4,
    emit: (event) => events.push(event),
    rng: seeded(10),
    timerScale: 0.001
  });
  const human = runtime.addPlayer("Boundary QA");
  runtime.enableSoloPlaytest(human.id, "MAILMAN");
  driveToDraw(runtime);
  assert.equal(roleFor(runtime, human), "MAILMAN");
  runtime.ship(human.id);
  (runtime as unknown as { startRevealHold: () => void }).startRevealHold();
  activate(runtime);
  (runtime as unknown as { openBoundaryPrompts: () => void }).openBoundaryPrompts();

  const promptEvent = eventsOf(events, "boundaryPrompt").find((event) => event.target.scope === "player" && event.target.playerId === human.id);
  assert(promptEvent, "Expected boundary prompt for human mailman");
  const payload = promptEvent.payload as BoundaryPromptPayload;
  const choice = payload.options[0]?.value;
  assert(choice, "Boundary prompt should include at least one choice");
  (runtime as unknown as { revealHoldOpenedAt: number }).revealHoldOpenedAt = Date.now() - 10_000;
  runtime.boundaryPick(human.id, choice);
  assert.notEqual(runtime.state.phase, "REVEAL_HOLD", "Boundary pick should advance after the last pending prompt");
  runtime.dispose();
});

runScenario("mailmen can send emoji but not chat", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 4,
    emit: (event) => events.push(event),
    rng: seeded(20),
    timerScale: 0.001
  });
  const human = runtime.addPlayer("Mailman Emoji");
  runtime.enableSoloPlaytest(human.id, "MAILMAN");
  driveToDraw(runtime);
  runtime.submitChat(human.id, "I should not be chat-enabled.");
  runtime.submitEmoji(human.id, "eyes");
  assert.equal(eventsOf(events, "chatBroadcast").length, 0);
  assert.equal(eventsOf(events, "emoji").length, 1);
  runtime.dispose();
});

runScenario("guess visibility keeps guesses private outside the sender", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 0,
    emit: (event) => events.push(event),
    rng: seeded(30),
    timerScale: 0.001
  });
  for (const name of ["A1", "B1", "A2", "B2", "A3", "B3"]) runtime.addPlayer(name);
  driveToDraw(runtime);
  const crew = playerWithRole(runtime, "A", "CREW", true);
  const word = currentWord(runtime, "A");
  runtime.submitGuess(crew.id, `${word.slice(0, Math.max(1, word.length - 1))}x`);
  runtime.submitGuess(crew.id, word);

  const guesses = eventsOf(events, "guessPublic").map((event) => ({
    target: event.target,
    payload: event.payload as GuessPublicPayload
  }));
  assert(guesses.some((entry) => entry.target.scope === "player" && entry.target.playerId === crew.id && entry.payload.text), "Sender should see their own guess text");
  assert(guesses.some((entry) => entry.payload.mask?.length), "Other players should receive obfuscated guess masks");
  assert(
    guesses
      .filter((entry) => entry.target.scope === "player" && entry.target.playerId !== crew.id)
      .every((entry) => !entry.payload.text),
    "Other players should not receive raw guess text"
  );
  runtime.dispose();
});

runScenario("late drawing cutoff captures in-progress strokes only", () => {
  const events: RuntimeEvent[] = [];
  const runtime = new MatchRuntime({
    autoStartMinPerBranch: 4,
    emit: (event) => events.push(event),
    rng: seeded(40),
    timerScale: 0.001
  });
  runtime.addPlayer("Drawer QA");
  driveToDraw(runtime);
  const postmaster = playerWithRole(runtime, "A", "POSTMASTER");
  runtime.submitStroke(postmaster.id, makeStroke(-500, -100));
  runtime.ship(playerWithRole(runtime, "A", "MAILMAN").id);
  const acceptedLate = makeStroke(-100, 10);
  const rejectedLate = makeStroke(100, 200);
  runtime.submitStroke(postmaster.id, acceptedLate);
  runtime.submitStroke(postmaster.id, rejectedLate);
  assert(runtime.state.branches[0].roundStrokeLog.some((stroke) => stroke.id === acceptedLate.id));
  assert(!runtime.state.branches[0].roundStrokeLog.some((stroke) => stroke.id === rejectedLate.id));
  assert(eventsOf(events, "error").some((event) => (event.payload as { code: string }).code === "PHASE_FORBIDDEN"));
  runtime.dispose();
});

console.log("QA simulations passed.");
