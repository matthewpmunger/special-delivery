"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@special-delivery/shared/events";
import { readStoredSeatSession, storedSeatMatchesCurrentRoom } from "../session";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

declare global {
  interface Window {
    __SPECIAL_DELIVERY_CONFIG__?: {
      rtServerUrl?: string;
    };
  }
}

let socket: GameSocket | undefined;

export function getSocket(): GameSocket {
  if (!socket) {
    const runtimeUrl =
      typeof window !== "undefined" ? window.__SPECIAL_DELIVERY_CONFIG__?.rtServerUrl : undefined;
    const url = runtimeUrl || process.env.NEXT_PUBLIC_RT_SERVER_URL || "http://localhost:4000";
    const session = readStoredSeatSession();
    socket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: session && storedSeatMatchesCurrentRoom(session) ? { session } : {}
    });
  }
  return socket;
}
