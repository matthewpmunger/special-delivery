"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@special-delivery/shared/events";
import { readStoredSeatSession, storedSeatMatchesCurrentRoom } from "../session";
import { fallbackSocketServerUrl, normalizeSocketServerUrl } from "./socket-url";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

declare global {
  interface Window {
    __SPECIAL_DELIVERY_CONFIG__?: {
      rtServerUrl?: string;
    };
  }
}

let socket: GameSocket | undefined;

export function getSocketServerUrl(): string {
  const runtimeUrl =
    typeof window !== "undefined" ? window.__SPECIAL_DELIVERY_CONFIG__?.rtServerUrl?.trim() : undefined;
  const fallbackUrl = fallbackSocketServerUrl(typeof window !== "undefined" ? window.location.hostname : undefined);
  return normalizeSocketServerUrl(runtimeUrl || process.env.NEXT_PUBLIC_RT_SERVER_URL || fallbackUrl);
}

export function getSocket(): GameSocket {
  if (!socket) {
    const url = getSocketServerUrl();
    const session = readStoredSeatSession();
    socket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: session && storedSeatMatchesCurrentRoom(session) ? { session } : {}
    });
  }
  return socket;
}
