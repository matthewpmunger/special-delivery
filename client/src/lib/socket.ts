"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@special-delivery/shared/events";
import { readStoredSeatSession, storedSeatMatchesCurrentRoom } from "../session";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | undefined;

export function getSocket(): GameSocket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_RT_SERVER_URL ?? "http://localhost:4000";
    const session = readStoredSeatSession();
    socket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: session && storedSeatMatchesCurrentRoom(session) ? { session } : {}
    });
  }
  return socket;
}
