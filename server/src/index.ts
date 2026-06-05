import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { Player } from "@special-delivery/shared";
import type { ClientToServerEvents, ServerToClientEvents } from "@special-delivery/shared/events";
import { openTelemetryDb } from "./db";
import { MatchRegistry, type MatchRuntime, type RuntimeEvent } from "./match";
import { branchRoom, matchRoom } from "./rooms";
import { Telemetry } from "./telemetry";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGINS = corsOrigin(process.env.CLIENT_ORIGIN, "http://localhost:3000");

const app = express();
app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ["GET", "POST"]
  }
});

const db = openTelemetryDb();
const telemetry = new Telemetry(db);

function emitRuntimeEvent(event: RuntimeEvent): void {
  if (event.target.scope === "match") {
    io.to(matchRoom(event.matchId)).emit(event.event as keyof ServerToClientEvents, event.payload as never);
    return;
  }
  if (event.target.scope === "branch") {
    io.to(branchRoom(event.matchId, event.target.branchId)).emit(event.event as keyof ServerToClientEvents, event.payload as never);
    return;
  }
  io.to(`player:${event.target.playerId}`).emit(event.event as keyof ServerToClientEvents, event.payload as never);
}

const registry = new MatchRegistry({
  telemetry,
  timerScale: Number(process.env.MATCH_TIMER_SCALE ?? 1),
  emit: emitRuntimeEvent
});
const socketsByPlayer = new Map<string, Set<string>>();

function corsOrigin(value: string | undefined, fallback: string): string | string[] {
  if ((value || "").trim() === "*") return "*";
  return envOriginList(value, fallback);
}

function envOriginList(value: string | undefined, fallback: string): string[] {
  const entries = (value || fallback)
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => originFromUrl(entry))
    .filter(Boolean);
  return entries.length > 0 ? entries : [fallback];
}

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "special-delivery-server" });
});

app.get("/results/:code", (req, res) => {
  const match = registry.byCode(req.params.code ?? "");
  if (!match) {
    res.status(404).json({ error: "No match with that code" });
    return;
  }
  res.json({
    code: match.state.code,
    phase: match.state.phase,
    scores: Object.fromEntries(match.state.branches.map((branch) => [branch.id, branch.score]))
  });
});

type GameSocket = Parameters<Parameters<typeof io.on>[1]>[0];

io.on("connection", (socket) => {
  bindResumeSession(socket, socket.handshake.auth);

  socket.on("joinLobby", (payload) => {
    const joined = payload.create ? registry.create(payload.nickname) : registry.join(payload.code, payload.nickname);
    if (!joined) {
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "No room with that code. Create a room or check the link." });
      return;
    }
    bindSocketToPlayer(socket, joined.match, joined.player);
    socket.emit("lobbyState", joined.match.lobbyState());
    socket.emit("state", joined.match.snapshotFor(joined.player.id));
  });

  socket.on("resumeLobby", (payload) => {
    const resumed = registry.resume(payload.code, payload.playerId);
    if (!resumed) {
      socket.emit("error", {
        code: "RESUME_NOT_FOUND",
        message: "That lobby session expired. Rejoin the room to keep playing."
      });
      return;
    }
    const { match, player } = resumed;
    bindSocketToPlayer(socket, match, player);
    match.reconnectPlayer(player.id);
    socket.emit("lobbyState", match.lobbyState());
    socket.emit("state", match.snapshotFor(player.id));
  });

  socket.on("startMatch", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    if (payload.soloPlaytest) match.enableSoloPlaytest(socket.data.playerId, payload.soloRole);
    if (payload.soloScrambleTest) {
      match.startSoloScrambleTest(socket.data.playerId, payload.drawGuessSeconds);
      return;
    }
    match.startMatch(payload.cyclesTotal, payload.drawGuessSeconds);
  });

  socket.on("rankManifest", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitManifestRank(socket.data.playerId, payload.order);
  });

  socket.on("stroke", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitStroke(socket.data.playerId, payload);
  });

  socket.on("undo", () => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.undo(socket.data.playerId);
  });

  socket.on("clear", () => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.clear(socket.data.playerId);
  });

  socket.on("guess", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitGuess(socket.data.playerId, payload.text);
  });

  socket.on("chat", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitChat(socket.data.playerId, payload.text);
  });

  socket.on("emojiMessage", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitEmoji(socket.data.playerId, payload.emojiId);
  });

  socket.on("emojiReact", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.submitEmoji(socket.data.playerId, payload.emojiId, payload.bubbleId);
  });

  socket.on("ship", () => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.ship(socket.data.playerId);
  });

  socket.on("chooseReward", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.chooseReward(socket.data.playerId, payload.rewardId);
  });

  socket.on("boundaryPick", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.boundaryPick(socket.data.playerId, payload.choice);
  });

  socket.on("scrambleSort", (payload) => {
    const match = matchForSocket(socket);
    if (!match) return;
    match.scrambleSort(socket.data.playerId, payload.pieceId, payload.binId);
  });

  socket.on("vote", () => {
    const match = matchForSocket(socket);
    if (!match) return;
    socket.emit("marv", {
      type: "flow",
      text: "I noted the vote. That clipboard is still prototype-grade.",
      scope: "player"
    });
  });

  socket.on("disconnect", () => {
    releaseSocketPlayer(socket);
  });
});

function bindResumeSession(socket: GameSocket, auth: unknown): void {
  const payload = resumePayloadFrom(auth);
  if (!payload) return;
  const resumed = registry.resume(payload.code, payload.playerId);
  if (!resumed) return;
  bindSocketToPlayer(socket, resumed.match, resumed.player);
  resumed.match.reconnectPlayer(resumed.player.id);
}

function bindSocketToPlayer(socket: GameSocket, match: MatchRuntime, player: Pick<Player, "id" | "branchId">): void {
  const previousPlayerId = socket.data.playerId as string | undefined;
  if (previousPlayerId && previousPlayerId !== player.id) releaseSocketPlayer(socket);
  socket.data.playerId = player.id;
  const activeSockets = socketsByPlayer.get(player.id) ?? new Set<string>();
  activeSockets.add(socket.id);
  socketsByPlayer.set(player.id, activeSockets);
  socket.join(matchRoom(match.state.id));
  socket.join(branchRoom(match.state.id, player.branchId));
  socket.join(`player:${player.id}`);
}

function releaseSocketPlayer(socket: GameSocket): void {
  const playerId = socket.data.playerId as string | undefined;
  if (!playerId) return;
  const activeSockets = socketsByPlayer.get(playerId);
  activeSockets?.delete(socket.id);
  if (!activeSockets || activeSockets.size === 0) {
    socketsByPlayer.delete(playerId);
    registry.byPlayer(playerId)?.disconnectPlayer(playerId);
  }
  socket.data.playerId = undefined;
}

function resumePayloadFrom(auth: unknown): { code: string; playerId: string } | undefined {
  if (!auth || typeof auth !== "object") return undefined;
  const record = auth as Record<string, unknown>;
  const session = record.session && typeof record.session === "object" ? (record.session as Record<string, unknown>) : record;
  const code = typeof session.code === "string" ? session.code : undefined;
  const playerId = typeof session.playerId === "string" ? session.playerId : undefined;
  if (!code || !playerId) return undefined;
  return { code, playerId };
}

function matchForSocket(socket: GameSocket) {
  const playerId = socket.data.playerId as string | undefined;
  if (!playerId) {
    socket.emit("error", { code: "NOT_JOINED", message: "Join a lobby before sending match events." });
    return undefined;
  }
  const match = registry.byPlayer(playerId);
  if (!match) {
    socket.emit("error", { code: "MATCH_NOT_FOUND", message: "MARV misplaced that room code." });
    return undefined;
  }
  return match;
}

server.listen(PORT, () => {
  console.log(`Special Delivery real-time server listening on http://localhost:${PORT}`);
});
