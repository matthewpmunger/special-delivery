"use client";

import type { ClientSnapshot } from "@special-delivery/shared";

const SESSION_KEY = "special-delivery:seat";

export interface StoredSeatSession {
  code: string;
  playerId: string;
  nickname: string;
}

export function readStoredSeatSession(): StoredSeatSession | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredSeatSession>;
    if (!parsed.code || !parsed.playerId || !parsed.nickname) return undefined;
    return {
      code: normalizeRoomCode(parsed.code),
      playerId: parsed.playerId,
      nickname: parsed.nickname
    };
  } catch {
    return undefined;
  }
}

export function writeSeatSessionFromSnapshot(snapshot: ClientSnapshot): StoredSeatSession {
  const ownPlayer = snapshot.ownBranch.players.find((player) => player.id === snapshot.playerId);
  const session: StoredSeatSession = {
    code: normalizeRoomCode(snapshot.code),
    playerId: snapshot.playerId,
    nickname: ownPlayer?.nickname ?? "Postal Trainee"
  };
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  return session;
}

export function clearStoredSeatSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

export function storedSeatMatchesCurrentRoom(session: StoredSeatSession): boolean {
  if (typeof window === "undefined") return true;
  const room = new URLSearchParams(window.location.search).get("room");
  return !room || normalizeRoomCode(room) === session.code;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
