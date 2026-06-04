"use client";

import { Howl } from "howler";

export type Cue =
  | "ui-click"
  | "ui-copy"
  | "room-created"
  | "player-joined"
  | "match-start"
  | "phase-intro"
  | "manifest-open"
  | "manifest-lock"
  | "manifest-aligned"
  | "manifest-diverged"
  | "draw-start"
  | "brush-stroke"
  | "fill-tool"
  | "undo"
  | "clear-canvas"
  | "chat-send"
  | "guess-wrong"
  | "guess-correct"
  | "guess-close"
  | "emoji-pop"
  | "timer-tick"
  | "timer-expired"
  | "ship"
  | "reveal-start"
  | "score-pop"
  | "round-win"
  | "boundary-open"
  | "boundary-pick"
  | "reward-available"
  | "reward-chosen"
  | "scramble-start"
  | "scramble-correct"
  | "scramble-wrong"
  | "scramble-end"
  | "closing-time"
  | "match-end"
  | "error";

const SOURCES: Record<Cue, string[]> = {
  "ui-click": ["/sfx/ui-click.ogg"],
  "ui-copy": ["/sfx/ui-copy.ogg"],
  "room-created": ["/sfx/room-created.ogg"],
  "player-joined": ["/sfx/player-joined.ogg"],
  "match-start": ["/sfx/match-start.ogg"],
  "phase-intro": ["/sfx/phase-intro.ogg"],
  "manifest-open": ["/sfx/manifest-open.ogg"],
  "manifest-lock": ["/sfx/manifest-lock.ogg"],
  "manifest-aligned": ["/sfx/manifest-aligned.ogg"],
  "manifest-diverged": ["/sfx/manifest-diverged.ogg"],
  "draw-start": ["/sfx/draw-start.ogg"],
  "brush-stroke": ["/sfx/brush-stroke.ogg"],
  "fill-tool": ["/sfx/fill-tool.ogg"],
  undo: ["/sfx/undo.ogg"],
  "clear-canvas": ["/sfx/clear-canvas.ogg"],
  "chat-send": ["/sfx/chat-send.ogg"],
  "guess-wrong": ["/sfx/guess-wrong.ogg"],
  "guess-correct": ["/sfx/guess-correct.ogg"],
  "guess-close": ["/sfx/guess-close.ogg"],
  "emoji-pop": ["/sfx/emoji-pop.ogg"],
  "timer-tick": ["/sfx/timer-tick.ogg"],
  "timer-expired": ["/sfx/timer-expired.ogg"],
  ship: ["/sfx/ship.ogg"],
  "reveal-start": ["/sfx/reveal-start.ogg"],
  "score-pop": ["/sfx/score-pop.ogg"],
  "round-win": ["/sfx/round-win.ogg"],
  "boundary-open": ["/sfx/boundary-open.ogg"],
  "boundary-pick": ["/sfx/boundary-pick.ogg"],
  "reward-available": ["/sfx/reward-available.ogg"],
  "reward-chosen": ["/sfx/reward-chosen.ogg"],
  "scramble-start": ["/sfx/scramble-start.ogg"],
  "scramble-correct": ["/sfx/scramble-correct.ogg"],
  "scramble-wrong": ["/sfx/scramble-wrong.ogg"],
  "scramble-end": ["/sfx/scramble-end.ogg"],
  "closing-time": ["/sfx/closing-time.ogg"],
  "match-end": ["/sfx/match-end.ogg"],
  error: ["/sfx/error.ogg"]
};

const VOLUME: Partial<Record<Cue, number>> = {
  "brush-stroke": 0.22,
  "timer-tick": 0.32,
  "ui-click": 0.35,
  "ui-copy": 0.4,
  "chat-send": 0.38,
  "emoji-pop": 0.42,
  error: 0.45
};

const MIN_INTERVAL: Partial<Record<Cue, number>> = {
  "brush-stroke": 150,
  "timer-tick": 650,
  "ui-click": 80,
  "chat-send": 120,
  "emoji-pop": 90,
  error: 300
};

const cache = new Map<Cue, Howl>();
const lastPlayed = new Map<Cue, number>();

export function playCue(cue: Cue): void {
  const src = SOURCES[cue];
  if (!src?.length) return;
  const now = Date.now();
  const minInterval = MIN_INTERVAL[cue] ?? 0;
  if (minInterval > 0 && now - (lastPlayed.get(cue) ?? 0) < minInterval) return;
  lastPlayed.set(cue, now);

  let howl = cache.get(cue);
  if (!howl) {
    howl = new Howl({ src, volume: VOLUME[cue] ?? 0.55 });
    cache.set(cue, howl);
  }
  howl.play();
}
