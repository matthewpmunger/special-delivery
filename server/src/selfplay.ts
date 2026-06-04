import { Telemetry } from "./telemetry";
import { MatchRuntime, type RuntimeEvent } from "./match";
import type { BoundaryPromptPayload, RoundStartPayload, ScrambleStatePayload } from "@special-delivery/shared/events";
import type { ClientSnapshot } from "@special-delivery/shared";

const telemetry = new Telemetry();
const scheduledGuessers = new Set<string>();
const runtime = new MatchRuntime({
  code: "SELF",
  cyclesTotal: 1,
  timerScale: 0.003,
  telemetry,
  emit: handleEvent
});

let ended = false;
let resolveDone: (() => void) | undefined;
const done = new Promise<void>((resolve) => {
  resolveDone = resolve;
});

for (let index = 0; index < 8; index += 1) {
  runtime.addPlayer(`Selfplay ${index + 1}`);
}

runtime.startMatch(1);

function handleEvent(event: RuntimeEvent): void {
  if (event.target.scope !== "player") {
    if (event.event === "scrambleState") {
      handleScramble(event.payload as ScrambleStatePayload);
    }
    if (event.event === "matchEnd") {
      ended = true;
      resolveDone?.();
    }
    return;
  }

  const playerId = event.target.playerId;
  if (event.event === "roundStart") {
    const payload = event.payload as RoundStartPayload;
    if (payload.manifestCandidates?.length === 3) {
      runtime.submitManifestRank(playerId, payload.manifestCandidates.map((candidate) => candidate.id) as [string, string, string]);
    }
  }

  if (event.event === "state") {
    const snapshot = event.payload as ClientSnapshot;
    if (snapshot.phase === "DRAW_GUESS" && snapshot.role === "CREW") {
      const key = `${snapshot.roundIndex}:${playerId}`;
      if (!scheduledGuessers.has(key)) {
        scheduledGuessers.add(key);
        const word = runtime.state.branches.find((branch) => branch.id === snapshot.branchId)?.word;
        const delay = 20 + Math.floor(Math.random() * 90);
        if (word) {
          setTimeout(() => runtime.submitGuess(playerId, word), delay);
        }
      }
    }
  }

  if (event.event === "boundaryPrompt") {
    const payload = event.payload as BoundaryPromptPayload;
    const choice = payload.options[0]?.value;
    if (choice) {
      setTimeout(() => runtime.boundaryPick(playerId, choice), 20);
    }
  }
}

function handleScramble(payload: ScrambleStatePayload): void {
  for (const piece of payload.pieces.slice(0, 12)) {
    const playerId = piece.assignedTo;
    if (playerId) runtime.scrambleSort(playerId, piece.id, piece.type);
  }
}

const watchdog = setTimeout(() => {
  if (!ended) {
    console.error("Self-play timed out before matchEnd.");
    runtime.dispose();
    process.exitCode = 1;
    resolveDone?.();
  }
}, 10_000);

await done;
clearTimeout(watchdog);

console.log("Self-play finished.");
console.log(
  JSON.stringify(
    {
      phase: runtime.state.phase,
      scores: Object.fromEntries(runtime.state.branches.map((branch) => [branch.id, branch.score])),
      events: telemetry.events.length,
      rounds: runtime.state.roundIndex + 1
    },
    null,
    2
  )
);

runtime.dispose();
