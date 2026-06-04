"use client";

import { create } from "zustand";
import type {
  BoundaryPromptPayload,
  ChatEntryPayload,
  EmojiPayload,
  GuessPublicPayload,
  LobbyStatePayload,
  MarvPayload,
  ScrambleResultPayload,
  ScrambleStatePayload
} from "@special-delivery/shared/events";
import type {
  ClientSnapshot,
  MailType,
  MatchEndPayload,
  PostageClass,
  ShipRevealPayload,
  Stroke
} from "@special-delivery/shared";
import { getSocket, type GameSocket } from "./lib/socket";
import { playCue } from "./audio";
import {
  clearStoredSeatSession,
  readStoredSeatSession,
  storedSeatMatchesCurrentRoom,
  writeSeatSessionFromSnapshot,
  type StoredSeatSession
} from "./session";

export type TimelineEntry =
  | ({ kind: "marv" } & MarvPayload & { id: string; ts: number })
  | ({ kind: "chat" } & ChatEntryPayload)
  | ({ kind: "guess" } & GuessPublicPayload & { id: string; ts: number });

interface GameStore {
  connected: boolean;
  lobby?: LobbyStatePayload;
  snapshot?: ClientSnapshot;
  reveal?: ShipRevealPayload;
  boundaryPrompt?: BoundaryPromptPayload;
  scramble?: ScrambleStatePayload;
  scrambleResult?: ScrambleResultPayload;
  matchEnd?: MatchEndPayload;
  timeline: TimelineEntry[];
  emojis: EmojiPayload[];
  lastError?: string;
  initialize: () => void;
  leaveToMainMenu: () => void;
  join: (code: string | undefined, nickname: string, create?: boolean) => void;
  startMatch: (options?: {
    cyclesTotal?: number;
    soloPlaytest?: boolean;
    soloScrambleTest?: boolean;
    soloRole?: "POSTMASTER" | "CREW" | "MAILMAN";
    drawGuessSeconds?: number;
  }) => void;
  rankManifest: (order: [string, string, string]) => void;
  sendStroke: (stroke: Stroke) => void;
  undo: () => void;
  clear: () => void;
  guess: (text: string) => void;
  chat: (text: string) => void;
  emoji: (emojiId: string, bubbleId?: string) => void;
  ship: () => void;
  boundaryPick: (choice: PostageClass | MailType) => void;
  scrambleSort: (pieceId: string, binId: MailType) => void;
}

let listenersBound = false;

type StoreSet = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
type StoreGet = () => GameStore;

function setSocketSession(socket: GameSocket, session?: StoredSeatSession): void {
  socket.auth = session && storedSeatMatchesCurrentRoom(session) ? { session } : {};
}

function resumeStoredSeat(socket: GameSocket): boolean {
  const session = readStoredSeatSession();
  if (!session || !storedSeatMatchesCurrentRoom(session)) return false;
  setSocketSession(socket, session);
  socket.emit("resumeLobby", { code: session.code, playerId: session.playerId });
  return true;
}

function bindSocketListeners(set: StoreSet, get: StoreGet): GameSocket {
  const socket = getSocket();
  if (listenersBound) return socket;
  listenersBound = true;
  socket.on("connect", () => {
    set({ connected: true });
    resumeStoredSeat(socket);
  });
  socket.on("disconnect", () => set({ connected: false }));
  socket.on("lobbyState", (lobby) => {
    const previousCount = get().lobby?.players.length;
    if (previousCount !== undefined && lobby.players.length > previousCount) playCue("player-joined");
    set({ lobby });
  });
  socket.on("state", (snapshot) => {
    const session = writeSeatSessionFromSnapshot(snapshot);
    setSocketSession(socket, session);
    set((state) => ({
      snapshot,
      boundaryPrompt: snapshot.phase === "REVEAL_HOLD" ? state.boundaryPrompt : undefined
    }));
  });
  socket.on("roundStart", ({ snapshot }) => {
    if (get().snapshot?.phase === "LOBBY") playCue("match-start");
    const session = writeSeatSessionFromSnapshot(snapshot);
    setSocketSession(socket, session);
    set({ snapshot, reveal: undefined, boundaryPrompt: undefined, scrambleResult: undefined });
    addTimeline(set, {
      kind: "marv",
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: "flow",
      text: roundRoleLine(snapshot),
      scope: "player"
    });
  });
  socket.on("manifestResult", (payload) => {
    const text = payload.agreed
      ? `Manifest aligned${payload.slot ? ` on slot ${payload.slot}` : ""}.`
      : "Manifest diverged.";
    playCue(payload.agreed ? "manifest-aligned" : "manifest-diverged");
    addTimeline(set, { kind: "marv", id: crypto.randomUUID(), ts: Date.now(), type: "flow", text, scope: "match" });
  });
  socket.on("strokeBroadcast", (stroke) => {
    const current = get().snapshot;
    if (!current) return;
    set({ snapshot: snapshotWithStroke(current, stroke) });
  });
  socket.on("guessFeedback", (payload) => {
    if (payload.result === "correct") playCue("guess-correct");
    if (payload.result === "close") playCue("guess-close");
    if (payload.result === "wrong") playCue("guess-wrong");
  });
  socket.on("guessPublic", (payload) =>
    addTimeline(set, { ...payload, kind: "guess", id: crypto.randomUUID(), ts: Date.now() })
  );
  socket.on("warmth", ({ own, summary }) => {
    const current = get().snapshot;
    if (!current) return;
    set({
      snapshot: {
        ...current,
        ownBranch: {
          ...current.ownBranch,
          ownWarmth: own ?? current.ownBranch.ownWarmth,
          warmthSummary: summary ?? current.ownBranch.warmthSummary
        }
      }
    });
  });
  socket.on("chatBroadcast", (entry) => addTimeline(set, { ...entry, kind: "chat" }));
  socket.on("emoji", (emoji) => {
    playCue("emoji-pop");
    set((state) => ({ emojis: [...state.emojis.slice(-12), emoji] }));
  });
  socket.on("shipReveal", (reveal) => {
    const currentReveal = get().reveal;
    if (!currentReveal || currentReveal.revealStartAt !== reveal.revealStartAt) playCue("reveal-start");
    set({ reveal });
  });
  socket.on("boundaryPrompt", (boundaryPrompt) => {
    playCue("boundary-open");
    set({ boundaryPrompt });
  });
  socket.on("marv", (payload) =>
    addTimeline(set, { ...payload, kind: "marv", id: crypto.randomUUID(), ts: Date.now() })
  );
  socket.on("scrambleState", (scramble) => {
    const previous = get().scramble;
    if (!previous) {
      playCue("scramble-start");
    } else {
      const previousTotal = previous.scores.A + previous.scores.B;
      const nextTotal = scramble.scores.A + scramble.scores.B;
      if (nextTotal > previousTotal) playCue("scramble-correct");
      if (nextTotal < previousTotal) playCue("scramble-wrong");
    }
    set({ scramble });
  });
  socket.on("scrambleResult", (scrambleResult) => {
    playCue("scramble-end");
    set({ scrambleResult, scramble: undefined });
  });
  socket.on("matchEnd", (matchEnd) => {
    playCue("match-end");
    set({ matchEnd });
  });
  socket.on("error", (error) => {
    if (error.code === "NOT_JOINED" && resumeStoredSeat(socket)) {
      set({ lastError: undefined });
      return;
    }
    if (error.code === "RESUME_NOT_FOUND") {
      clearStoredSeatSession();
      setSocketSession(socket);
      set({ snapshot: undefined, lobby: undefined });
    }
    playCue("error");
    set({ lastError: error.message });
  });
  return socket;
}

export const useGameStore = create<GameStore>((set, get) => ({
  connected: false,
  timeline: [],
  emojis: [],
  initialize: () => {
    const socket = bindSocketListeners(set, get);
    set({ connected: socket.connected });
    if (socket.connected) resumeStoredSeat(socket);
  },
  leaveToMainMenu: () => {
    const socket = bindSocketListeners(set, get);
    clearStoredSeatSession();
    setSocketSession(socket);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url);
    }
    set({
      lobby: undefined,
      snapshot: undefined,
      reveal: undefined,
      boundaryPrompt: undefined,
      scramble: undefined,
      scrambleResult: undefined,
      matchEnd: undefined,
      timeline: [],
      emojis: [],
      lastError: undefined
    });
    socket.disconnect();
    socket.connect();
  },
  join: (code, nickname, create = false) => {
    const socket = bindSocketListeners(set, get);
    clearStoredSeatSession();
    setSocketSession(socket);
    set({
      lastError: undefined,
      reveal: undefined,
      boundaryPrompt: undefined,
      scramble: undefined,
      scrambleResult: undefined,
      matchEnd: undefined,
      timeline: [],
      emojis: []
    });
    socket.emit("joinLobby", { code, nickname, create });
  },
  startMatch: (options) => getSocket().emit("startMatch", options ?? {}),
  rankManifest: (order) => getSocket().emit("rankManifest", { order }),
  sendStroke: (stroke) => {
    const current = get().snapshot;
    if (current) set({ snapshot: snapshotWithStroke(current, stroke) });
    getSocket().emit("stroke", stroke);
  },
  undo: () => getSocket().emit("undo", {}),
  clear: () => getSocket().emit("clear", {}),
  guess: (text) => getSocket().emit("guess", { text }),
  chat: (text) => getSocket().emit("chat", { text }),
  emoji: (emojiId, bubbleId) =>
    bubbleId ? getSocket().emit("emojiReact", { emojiId, bubbleId }) : getSocket().emit("emojiMessage", { emojiId }),
  ship: () => {
    playCue("ship");
    getSocket().emit("ship", {});
  },
  boundaryPick: (choice) => {
    playCue("boundary-pick");
    set({ boundaryPrompt: undefined });
    getSocket().emit("boundaryPick", { choice });
  },
  scrambleSort: (pieceId, binId) => {
    const current = get().scramble;
    const piece = current?.pieces.find((candidate) => candidate.id === pieceId);
    if (current && piece?.type === binId) {
      set({
        scramble: {
          ...current,
          pieces: current.pieces.map((candidate) =>
            candidate.id === pieceId ? { ...candidate, sortedBinId: binId } : candidate
          )
        }
      });
    }
    getSocket().emit("scrambleSort", { pieceId, binId });
  }
}));

function addTimeline(
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void,
  entry: TimelineEntry
): void {
  set((state) => ({ timeline: [...state.timeline.slice(-60), entry] }));
}

function snapshotWithStroke(snapshot: ClientSnapshot, stroke: Stroke): ClientSnapshot {
  const currentLog = snapshot.ownBranch.roundStrokeLog ?? [];
  if (currentLog.some((entry) => entry.id === stroke.id)) return snapshot;
  return {
    ...snapshot,
    ownBranch: {
      ...snapshot.ownBranch,
      roundStrokeLog: [...currentLog, stroke]
    }
  };
}

function roundRoleLine(snapshot: ClientSnapshot): string {
  const nameFor = (playerId: string) =>
    snapshot.ownBranch.players.find((player) => player.id === playerId)?.nickname ?? "unassigned";
  return `Round ${snapshot.roundIndex + 1}: your station is ${snapshot.role}. Postmaster: ${nameFor(
    snapshot.ownBranch.postmasterId
  )}. Mailman: ${nameFor(snapshot.ownBranch.mailmanId)}.`;
}
