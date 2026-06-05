import { customAlphabet, nanoid } from "nanoid";
import {
  BRANCH_NAMES,
  CLASS_TIER_LABEL,
  EMOJI_IDS,
  G,
  MAIL_TYPE_LABEL,
  TIMERS
} from "@special-delivery/shared";
import type {
  Branch,
  BranchId,
  ClientSnapshot,
  MailType,
  ManifestCandidate,
  Match,
  MatchEndPayload,
  Phase,
  PhaseIntroPayload,
  Player,
  PostageClass,
  RewardId,
  ShipRevealPayload,
  Stroke,
  WordEntry
} from "@special-delivery/shared";
import type {
  BoundaryPromptPayload,
  ChatEntryPayload,
  EmojiPayload,
  GuessMaskCell,
  GuessPublicPayload,
  LobbyStatePayload,
  ServerToClientEvents
} from "@special-delivery/shared/events";
import { botManifestOrder, makeBot, sampledCorrectTime } from "./bots";
import { checkGuess, normalizeGuess, RateLimiter, summarizeWarmth } from "./guessing";
import { MARV_LINES, marv } from "./marv";
import { randomItem, resolveManifest, selectManifestCandidates, shuffle } from "./manifest";
import { canChooseReward } from "./rewards";
import { branchRoundValue, resolveMatchWinner, roundWinner, stampValue } from "./scoring";
import {
  createScramble,
  isScrambleComplete,
  scrambleResult,
  scrambleState,
  sortPiece,
  type ScrambleRuntime
} from "./scramble";
import { createSnapshot, eligibleCrewIds, findPlayer, getBranch, otherBranchId, roleFor } from "./rooms";
import type { Telemetry } from "./telemetry";

export type RuntimeEventName = keyof ServerToClientEvents;

export interface RuntimeEvent {
  matchId: string;
  target:
    | { scope: "match" }
    | { scope: "branch"; branchId: BranchId }
    | { scope: "player"; playerId: string };
  event: RuntimeEventName;
  payload: unknown;
}

export interface MatchRuntimeOptions {
  code?: string;
  cyclesTotal?: number;
  timerScale?: number;
  telemetry?: Telemetry;
  emit?: (event: RuntimeEvent) => void;
  rng?: () => number;
  autoStartMinPerBranch?: number;
}

interface SoloPlaytestState {
  playerId: string;
  roleCycle: Array<"POSTMASTER" | "CREW" | "MAILMAN">;
}

interface BoundaryPromptInternal {
  promptId: string;
  branchId: BranchId;
  kind: "postageClass" | "mailType";
  openedAt: number;
  expiresAt: number;
}

interface PhaseIntroInput {
  kind: PhaseIntroPayload["kind"];
  title: string;
  subtitle?: string;
  body: string;
  durationMs: number;
}

const POSTAGE_CLASSES: PostageClass[] = ["STANDARD", "PRIORITY", "FIRST_CLASS"];
const MAIL_TYPES: MailType[] = ["POSTCARD", "GREETING_CARD", "PACKAGE", "TAKEOUT_MENU", "MAGAZINE", "NEWSPAPER"];
const WORD_HINT_TICKS = 8;
const DRAW_STROKE_GRACE_MS = 2_500;
const ROOM_CODE = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

export class MatchRuntime {
  readonly state: Match;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly telemetry?: Telemetry;
  private readonly emitSink?: (event: RuntimeEvent) => void;
  private readonly rng: () => number;
  private readonly timerScale: number;
  private readonly autoStartMinPerBranch: number;
  private manifestCandidates: ManifestCandidate[] = [];
  private manifestRankings: Partial<Record<BranchId, [string, string, string]>> = {};
  private currentWords: Partial<Record<BranchId, WordEntry>> = {};
  private currentReveal?: ShipRevealPayload;
  private currentPostmasters: Partial<Record<BranchId, string>> = {};
  private previousPostmasters: Partial<Record<BranchId, string>> = {};
  private drawCursor: Record<BranchId, number> = { A: 0, B: 0 };
  private pendingBoundary = new Map<BranchId, BoundaryPromptInternal>();
  private nextTerms: { postageClass: PostageClass; mailType: MailType };
  private revealHoldOpenedAt = 0;
  private currentDrawLockedAt?: number;
  private scramble?: ScrambleRuntime;
  private nextRoundAfterScramble?: number;
  private phaseIntro?: PhaseIntroPayload;
  private drawGuessDurationMs: number = TIMERS.DRAW_GUESS_DEFAULT;
  private readonly guessLimiter = new RateLimiter(8, 4_000);
  private readonly chatLimiter = new RateLimiter(6, 5_000);
  private soloPlaytest?: SoloPlaytestState;

  constructor(options: MatchRuntimeOptions = {}) {
    const now = Date.now();
    const id = nanoid(10);
    const code = (options.code ?? nanoid(5)).toUpperCase();
    this.telemetry = options.telemetry;
    this.emitSink = options.emit;
    this.rng = options.rng ?? Math.random;
    this.timerScale = options.timerScale ?? Number(process.env.MATCH_TIMER_SCALE ?? 1);
    this.autoStartMinPerBranch = options.autoStartMinPerBranch ?? 4;
    const postageClass = randomItem(POSTAGE_CLASSES, this.rng);
    const mailType = randomItem(MAIL_TYPES, this.rng);
    this.nextTerms = { postageClass, mailType };
    this.state = {
      id,
      code,
      phase: "LOBBY",
      phaseStartedAt: now,
      phaseEndsAt: now,
      roundIndex: 0,
      cycleIndex: 0,
      cyclesTotal: options.cyclesTotal ?? 1,
      postageClass,
      mailType,
      branches: [
        this.createBranch("A", BRANCH_NAMES[0] ?? "North Loop Branch"),
        this.createBranch("B", BRANCH_NAMES[1] ?? "Juniper Station")
      ]
    };
  }

  dispose(): void {
    this.clearTimers();
  }

  addPlayer(nickname: string): Player {
    const cleanNickname = nickname.trim().slice(0, 24) || "Postal Trainee";
    const branch = this.state.branches[0].players.length <= this.state.branches[1].players.length
      ? this.state.branches[0]
      : this.state.branches[1];
    const player: Player = {
      id: nanoid(10),
      nickname: cleanNickname,
      branchId: branch.id,
      isBot: false,
      connected: true
    };
    branch.players.push(player);
    this.emitLobbyState();
    this.telemetry?.append(this.state.id, "player_joined", { playerId: player.id, branchId: branch.id });
    return player;
  }

  announcePlayerJoined(player: Pick<Player, "id" | "nickname" | "branchId">): void {
    this.emitToMatch("marv", MARV_LINES.playerJoined(player.nickname));
    this.telemetry?.append(this.state.id, "player_joined_announced", { playerId: player.id, branchId: player.branchId });
  }

  reconnectPlayer(playerId: string): void {
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    player.connected = true;
    this.emitState(playerId);
    this.emitLobbyState();
  }

  disconnectPlayer(playerId: string): void {
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    player.connected = false;
    this.telemetry?.append(this.state.id, "player_disconnected", { playerId });
    this.emitLobbyState();
  }

  enableSoloPlaytest(playerId: string, startRole: "POSTMASTER" | "CREW" | "MAILMAN" = "POSTMASTER"): void {
    const baseCycle: SoloPlaytestState["roleCycle"] = ["POSTMASTER", "CREW", "MAILMAN"];
    const startIndex = Math.max(0, baseCycle.indexOf(startRole));
    this.soloPlaytest = {
      playerId,
      roleCycle: [...baseCycle.slice(startIndex), ...baseCycle.slice(0, startIndex)]
    };
    this.telemetry?.append(this.state.id, "solo_playtest_enabled", { playerId, startRole });
  }

  startMatch(cyclesTotal?: number, drawGuessSeconds?: number): void {
    if (this.state.phase !== "LOBBY") return;
    if (cyclesTotal) this.state.cyclesTotal = Math.max(1, cyclesTotal);
    if (drawGuessSeconds) this.drawGuessDurationMs = clampTimerSeconds(drawGuessSeconds) * 1_000;
    this.ensureBotFill();
    for (const branch of this.state.branches) {
      branch.drawOrder = shuffle(branch.players.map((player) => player.id), this.rng);
      this.drawCursor[branch.id] = 0;
    }
    this.emitGameIntro();
    this.telemetry?.append(this.state.id, "match_started", {
      cyclesTotal: this.state.cyclesTotal,
      players: this.state.branches.map((branch) => branch.players.length)
    });
    this.startRound();
  }

  startSoloScrambleTest(playerId: string, drawGuessSeconds?: number): void {
    if (this.state.phase !== "LOBBY") return;
    this.enableSoloPlaytest(playerId);
    this.state.cyclesTotal = Math.max(2, this.state.cyclesTotal);
    if (drawGuessSeconds) this.drawGuessDurationMs = clampTimerSeconds(drawGuessSeconds) * 1_000;
    this.ensureBotFill();
    for (const branch of this.state.branches) {
      branch.drawOrder = shuffle(branch.players.map((player) => player.id), this.rng);
      this.drawCursor[branch.id] = 0;
    }
    const midpointRound = Math.floor(this.totalRounds() / 2);
    this.state.roundIndex = Math.max(0, midpointRound - 1);
    this.nextRoundAfterScramble = midpointRound;
    this.emitGameIntro();
    this.telemetry?.append(this.state.id, "solo_scramble_test_started", {
      cyclesTotal: this.state.cyclesTotal,
      players: this.state.branches.map((branch) => branch.players.length)
    });
    this.startScramble();
  }

  submitManifestRank(playerId: string, order: [string, string, string]): void {
    if (!this.requireRoleAndPhase(playerId, "POSTMASTER", "MANIFEST")) return;
    if (!this.requirePhaseActive(playerId)) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    this.manifestRankings[player.branchId] = order;
    this.telemetry?.append(this.state.id, "manifest_ranked", { playerId, branchId: player.branchId, order });
    if (this.manifestRankings.A && this.manifestRankings.B) {
      this.resolveManifestNow();
    }
  }

  submitStroke(playerId: string, stroke: Stroke): void {
    if (!this.requireRole(playerId, "POSTMASTER")) return;
    if (this.state.phase !== "DRAW_GUESS") {
      if (this.acceptLateStroke(playerId, stroke)) return;
      this.emitError(playerId, "PHASE_FORBIDDEN", "That action is not open on this part of the route.");
      return;
    }
    if (!this.requireStrokePhaseActive(playerId, stroke)) return;
    this.appendStroke(playerId, stroke);
  }

  private appendStroke(playerId: string, stroke: Stroke): Branch | undefined {
    const player = findPlayer(this.state, playerId);
    if (!player) return undefined;
    const branch = getBranch(this.state, player.branchId);
    if (branch.roundStrokeLog.some((entry) => entry.id === stroke.id)) return branch;
    branch.roundStrokeLog.push(stroke);
    this.telemetry?.append(this.state.id, "stroke", { branchId: branch.id, points: stroke.points.length, op: stroke.op });
    for (const recipient of this.state.branches.flatMap((candidate) => candidate.players)) {
      const role = roleFor(this.state, recipient.id);
      const sameBranchCrew = recipient.branchId === branch.id && role === "CREW";
      const inspector = role === "INSPECTOR";
      if (!recipient.isBot && recipient.connected && (sameBranchCrew || inspector)) {
        this.emitToPlayer(recipient.id, "strokeBroadcast", stroke);
      }
    }
    return branch;
  }

  undo(playerId: string): void {
    if (!this.requireRoleAndPhase(playerId, "POSTMASTER", "DRAW_GUESS")) return;
    if (!this.requirePhaseActive(playerId)) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    getBranch(this.state, player.branchId).roundStrokeLog.pop();
    this.broadcastSnapshots();
  }

  clear(playerId: string): void {
    if (!this.requireRoleAndPhase(playerId, "POSTMASTER", "DRAW_GUESS")) return;
    if (!this.requirePhaseActive(playerId)) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    getBranch(this.state, player.branchId).roundStrokeLog = [];
    this.broadcastSnapshots();
  }

  submitGuess(playerId: string, text: string): void {
    if (!this.requireRoleAndPhase(playerId, "CREW", "DRAW_GUESS")) return;
    if (!this.requirePhaseActive(playerId)) return;
    if (!this.guessLimiter.accept(playerId)) {
      this.emitError(playerId, "RATE_LIMITED", "MARV needs one second to unjam the guess chute.");
      return;
    }
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const branch = getBranch(this.state, player.branchId);
    if (branch.correctGuessers.includes(playerId)) {
      this.emitError(playerId, "ALREADY_CORRECT", "Correct guessers steer with emoji.");
      return;
    }
    const word = this.currentWords[branch.id];
    if (!word) {
      this.emitError(playerId, "NO_WORD", "MARV cannot find the manifest word.");
      return;
    }

    const check = checkGuess(word, text);
    branch.previousWarmthBand[playerId] = branch.warmthByPlayer[playerId] ?? "LOW";
    branch.warmthByPlayer[playerId] = check.warmth;

    if (check.result === "correct") {
      branch.correctGuessers.push(playerId);
    }

    this.emitToPlayer(playerId, "guessFeedback", { result: check.result, warmth: check.warmth });
    this.emitGuessPublic(branch, player, text, check.result === "correct", word, check.normalizedGuess);
    this.emitWarmth(branch, playerId);
    this.telemetry?.append(this.state.id, "guess", {
      playerId,
      branchId: branch.id,
      result: check.result,
      warmth: check.warmth,
      distance: check.distance
    });

    if (branch.correctGuessers.length >= G(branch.players.length)) {
      this.endRound("sweep", branch.id);
      return;
    }
    this.broadcastSnapshots();
  }

  submitChat(playerId: string, text: string): void {
    if (!this.requireRole(playerId, "CREW")) return;
    if (!this.chatLimiter.accept(playerId)) {
      this.emitError(playerId, "RATE_LIMITED", "The chat mailbag is briefly full.");
      return;
    }
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const clean = text.trim().slice(0, 180);
    if (!clean) return;
    const entry: ChatEntryPayload = {
      id: nanoid(8),
      playerId,
      playerName: player.nickname,
      text: clean,
      ts: Date.now()
    };
    this.telemetry?.append(this.state.id, "chat", { playerId, branchId: player.branchId, length: clean.length });
    for (const recipient of this.state.branches.flatMap((branch) => branch.players)) {
      if (recipient.isBot || !recipient.connected) continue;
      const role = roleFor(this.state, recipient.id);
      if (role === "POSTMASTER" || role === "INSPECTOR") continue;
      if (recipient.branchId === player.branchId) {
        this.emitToPlayer(recipient.id, "chatBroadcast", entry);
      } else {
        this.emitToPlayer(recipient.id, "chatBroadcast", {
          ...entry,
          text: "Encrypted branch chatter",
          encrypted: true
        });
      }
    }
  }

  submitEmoji(playerId: string, emojiId: string, bubbleId?: string): void {
    const role = roleFor(this.state, playerId);
    if (role !== "MAILMAN" && role !== "CREW") {
      this.emitError(playerId, "ROLE_FORBIDDEN", "Only mailmen and crew can send emoji.");
      return;
    }
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const payload: EmojiPayload = {
      id: nanoid(8),
      playerId,
      playerName: player.nickname,
      emojiId,
      bubbleId,
      ts: Date.now()
    };
    this.emitToBranch(player.branchId, "emoji", payload);
    this.telemetry?.append(this.state.id, "emoji", { playerId, branchId: player.branchId, emojiId });
  }

  ship(playerId: string): void {
    if (!this.requireRoleAndPhase(playerId, "MAILMAN", "DRAW_GUESS")) return;
    if (!this.requirePhaseActive(playerId)) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    this.endRound("manual", player.branchId);
  }

  chooseReward(playerId: string, rewardId: RewardId): void {
    if (!this.requireRole(playerId, "MAILMAN")) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const branch = getBranch(this.state, player.branchId);
    const opponent = getBranch(this.state, otherBranchId(player.branchId));
    const phaseForReward = this.isClosingRound() ? "CLOSING" : this.state.phase;
    if (!canChooseReward(rewardId, branch.score, opponent.score, branch.players.length, phaseForReward)) {
      this.emitError(playerId, "REWARD_FORBIDDEN", "That reward is not available on this route.");
      return;
    }
    branch.activeReward = rewardId;
    this.telemetry?.append(this.state.id, "reward_chosen", { branchId: branch.id, rewardId });
    this.broadcastSnapshots();
  }

  boundaryPick(playerId: string, choice: PostageClass | MailType): void {
    if (!this.requireRole(playerId, "MAILMAN")) return;
    if (this.state.phase !== "REVEAL_HOLD") {
      this.emitError(playerId, "PHASE_FORBIDDEN", "Boundary picks happen after the reveal settles.");
      return;
    }
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const prompt = this.pendingBoundary.get(player.branchId);
    if (!prompt) {
      this.emitError(playerId, "NO_PROMPT", "I have not assigned this route decision to your station.");
      return;
    }
    if (Date.now() - this.revealHoldOpenedAt < this.scaled(TIMERS.REVEAL_HOLD_FLOOR)) {
      this.emitError(playerId, "TOO_EARLY", "MARV is still letting the stamps cool.");
      return;
    }
    if (prompt.kind === "postageClass" && POSTAGE_CLASSES.includes(choice as PostageClass)) {
      this.nextTerms.postageClass = choice as PostageClass;
    } else if (prompt.kind === "mailType" && MAIL_TYPES.includes(choice as MailType)) {
      this.nextTerms.mailType = choice as MailType;
    } else {
      this.emitError(playerId, "BAD_PICK", "That does not fit this clipboard.");
      return;
    }
    this.pendingBoundary.delete(player.branchId);
    this.telemetry?.append(this.state.id, "boundary_pick", {
      branchId: player.branchId,
      kind: prompt.kind,
      choice
    });
    if (this.pendingBoundary.size === 0) {
      this.advanceAfterReveal();
    }
  }

  scrambleSort(playerId: string, pieceId: string, binId: MailType): void {
    if (this.state.phase !== "SCRAMBLE" || !this.scramble) {
      this.emitError(playerId, "PHASE_FORBIDDEN", "No spilled truck is active.");
      return;
    }
    if (!this.requirePhaseActive(playerId)) return;
    const player = findPlayer(this.state, playerId);
    if (!player) return;
    const result = sortPiece(this.scramble, player, pieceId, binId);
    if (!result.accepted) return;
    this.telemetry?.append(this.state.id, "scramble_sort", {
      playerId,
      branchId: player.branchId,
      pieceId,
      binId,
      delta: result.delta
    });
    this.emitToMatch("scrambleState", scrambleState(this.scramble, this.state.phaseEndsAt));
    if (isScrambleComplete(this.scramble)) {
      this.endScramble();
    }
  }

  snapshotFor(playerId: string): ClientSnapshot {
    return createSnapshot(this.state, playerId, this.manifestCandidates, this.currentReveal, this.currentPhaseIntro());
  }

  lobbyState(): LobbyStatePayload {
    return {
      code: this.state.code,
      players: this.state.branches.flatMap((branch) => branch.players),
      branchNames: {
        A: this.state.branches[0].name,
        B: this.state.branches[1].name
      },
      canStart: this.state.phase === "LOBBY"
    };
  }

  private createBranch(id: BranchId, name: string): Branch {
    return {
      id,
      name,
      players: [],
      drawOrder: [],
      postmasterId: "",
      mailmanId: "",
      score: 0,
      roundsWon: 0,
      scrambleScore: 0,
      roundStrokeLog: [],
      warmthByPlayer: {},
      previousWarmthBand: {},
      correctGuessers: [],
      locked: false
    };
  }

  private ensureBotFill(): void {
    for (const branch of this.state.branches) {
      let index = branch.players.filter((player) => player.isBot).length;
      while (branch.players.length < this.autoStartMinPerBranch) {
        branch.players.push(makeBot(branch.id, index));
        index += 1;
      }
    }
  }

  private emitGameIntro(): void {
    this.emitToMatch("marv", MARV_LINES.introName());
    this.emitToMatch("marv", MARV_LINES.introScannerMishap());
    this.emitToMatch("marv", MARV_LINES.lobbyReady());
  }

  private startRound(): void {
    this.clearTimers();
    this.currentReveal = undefined;
    this.currentDrawLockedAt = undefined;
    this.scramble = undefined;
    this.pendingBoundary.clear();
    this.manifestRankings = {};
    this.currentWords = {};
    this.state.sharedWord = undefined;
    this.state.postageClass = this.nextTerms.postageClass;
    this.state.mailType = this.nextTerms.mailType;
    this.state.cycleIndex = Math.floor(this.state.roundIndex / this.roundsPerCycle());
    this.assignRoundRoles();
    for (const branch of this.state.branches) {
      branch.correctGuessers = [];
      branch.previousWarmthBand = {};
      branch.warmthByPlayer = {};
      branch.roundStrokeLog = [];
      branch.locked = false;
      branch.shippedValue = undefined;
      branch.activeReward = undefined;
      branch.word = undefined;
    }
    this.manifestCandidates = selectManifestCandidates(this.state.mailType, this.state.postageClass, this.rng);
    const closing = this.isClosingRound();
    const introMs = closing ? TIMERS.CLOSING_BRIEFING : TIMERS.ROUND_BRIEFING;
    this.setPhase("MANIFEST", TIMERS.MANIFEST, {
      kind: closing ? "CLOSING_TIME" : "ROUND_START",
      title: closing ? "Closing Time" : `Round ${this.state.roundIndex + 1}`,
      subtitle: `${MAIL_TYPE_LABEL[this.state.mailType]} · ${this.state.postageClass.replace("_", " ")}`,
      body: closing
        ? "Final route is double value. Postmasters lock the manifest after the horn."
        : "New route on the belt. Postmasters lock the manifest after the horn.",
      durationMs: introMs
    });
    this.emitToMatch("marv", MARV_LINES.roundStart(this.state.roundIndex + 1));
    if (closing) {
      this.emitToMatch("marv", marv("countdown", "Closing Time. Final round is double value; I locked the multiplier drawer."));
    }
    this.telemetry?.append(this.state.id, "round_started", {
      roundIndex: this.state.roundIndex,
      cycleIndex: this.state.cycleIndex,
      postageClass: this.state.postageClass,
      mailType: this.state.mailType,
      closing
    });
    this.broadcastRoundStart();
    this.scheduleSoloManifestRanks(introMs);
    this.schedule(() => this.resolveManifestNow(), introMs + TIMERS.MANIFEST);
  }

  private assignRoundRoles(): void {
    for (const branch of this.state.branches) {
      if (this.assignSoloRoles(branch)) continue;
      const postmasterId = this.nextHumanPostmaster(branch);
      const seedMailman = this.previousHumanBefore(branch, postmasterId);
      const mailmanId = this.previousPostmasters[branch.id] ?? seedMailman;
      branch.postmasterId = postmasterId;
      branch.mailmanId = mailmanId === postmasterId ? this.firstCrewCandidate(branch, postmasterId) : mailmanId;
      this.currentPostmasters[branch.id] = postmasterId;
    }
  }

  private assignSoloRoles(branch: Branch): boolean {
    if (!this.soloPlaytest) return false;
    const human = branch.players.find((player) => player.id === this.soloPlaytest?.playerId);
    if (!human) return false;
    const soloRole = this.soloPlaytest.roleCycle[this.state.roundIndex % this.soloPlaytest.roleCycle.length] ?? "POSTMASTER";
    const firstBot = this.firstBotCandidate(branch);
    const secondBot = this.firstBotCandidate(branch, [firstBot, human.id]);

    if (soloRole === "POSTMASTER") {
      branch.postmasterId = human.id;
      branch.mailmanId = firstBot;
    } else if (soloRole === "MAILMAN") {
      branch.postmasterId = firstBot;
      branch.mailmanId = human.id;
    } else {
      branch.postmasterId = firstBot;
      branch.mailmanId = secondBot;
    }

    if (branch.mailmanId === branch.postmasterId) {
      branch.mailmanId = this.firstCrewCandidate(branch, branch.postmasterId);
    }
    this.currentPostmasters[branch.id] = branch.postmasterId;
    return true;
  }

  private nextHumanPostmaster(branch: Branch): string {
    if (!branch.drawOrder.length) branch.drawOrder = branch.players.map((player) => player.id);
    for (let attempts = 0; attempts < branch.drawOrder.length; attempts += 1) {
      const index = this.drawCursor[branch.id] % branch.drawOrder.length;
      this.drawCursor[branch.id] = (this.drawCursor[branch.id] + 1) % branch.drawOrder.length;
      const playerId = branch.drawOrder[index] as string;
      const player = branch.players.find((candidate) => candidate.id === playerId);
      if (player && !player.isBot) return player.id;
    }
    const fallback = branch.players.find((player) => !player.isBot) ?? branch.players[0];
    return fallback?.id ?? "";
  }

  private previousHumanBefore(branch: Branch, postmasterId: string): string {
    const order = branch.drawOrder.length ? branch.drawOrder : branch.players.map((player) => player.id);
    const postmasterIndex = Math.max(0, order.indexOf(postmasterId));
    for (let offset = 1; offset <= order.length; offset += 1) {
      const index = (postmasterIndex - offset + order.length) % order.length;
      const player = branch.players.find((candidate) => candidate.id === order[index]);
      if (player && !player.isBot && player.id !== postmasterId) return player.id;
    }
    return this.firstCrewCandidate(branch, postmasterId);
  }

  private firstCrewCandidate(branch: Branch, excludedId: string): string {
    return branch.players.find((player) => player.id !== excludedId)?.id ?? excludedId;
  }

  private firstBotCandidate(branch: Branch, excludedIds: string[] = []): string {
    const bot = branch.players.find((player) => player.isBot && !excludedIds.includes(player.id));
    if (bot) return bot.id;
    return branch.players.find((player) => !excludedIds.includes(player.id))?.id ?? branch.players[0]?.id ?? "";
  }

  private resolveManifestNow(): void {
    if (this.state.phase !== "MANIFEST") return;
    this.clearTimers();
    const resolution = resolveManifest(this.manifestCandidates, this.manifestRankings, this.rng);
    this.currentWords = resolution.branchWords;
    for (const branch of this.state.branches) {
      branch.word = resolution.branchWords[branch.id].text;
    }
    this.state.sharedWord = resolution.sharedWord?.text;

    for (const branchId of resolution.timedOut) {
      this.emitToMatch("marv", MARV_LINES.autoManifest(branchId));
    }
    this.emitToMatch("marv", resolution.agreed && resolution.slot ? MARV_LINES.manifestAgreement(resolution.slot) : MARV_LINES.noManifestAgreement());

    for (const player of this.state.branches.flatMap((branch) => branch.players)) {
      if (player.isBot || !player.connected) continue;
      const role = roleFor(this.state, player.id);
      this.emitToPlayer(player.id, "manifestResult", {
        agreed: resolution.agreed,
        slot: resolution.slot,
        word: role === "POSTMASTER" ? resolution.branchWords[player.branchId].text : undefined,
        branchWords: role === "INSPECTOR"
          ? {
              A: resolution.branchWords.A.text,
              B: resolution.branchWords.B.text
            }
          : undefined
      });
    }

    this.telemetry?.append(this.state.id, "manifest_resolved", {
      agreed: resolution.agreed,
      slot: resolution.slot,
      timedOut: resolution.timedOut,
      diverged: resolution.branchWords.A.id !== resolution.branchWords.B.id
    });
    const introMs = TIMERS.DRAW_BRIEFING;
    this.setPhase("DRAW_GUESS", this.drawGuessDurationMs, {
      kind: "DRAW_START",
      title: resolution.agreed ? "Manifest Aligned" : "Manifest Diverged",
      subtitle: resolution.agreed && resolution.slot ? `Slot ${resolution.slot} selected` : "Branches are drawing different words",
      body: "Next up: Postmasters draw, crew guess in Regional chat, and mailmen decide when to ship.",
      durationMs: introMs
    });
    this.broadcastSnapshots();
    this.scheduleWordHintBroadcasts(introMs);
    this.scheduleSoloDrawGuess(introMs);
    this.schedule(() => this.endRound("timer"), introMs + this.drawGuessDurationMs);
  }

  private endRound(reason: ShipRevealPayload["reason"], shippedBy?: BranchId): void {
    if (this.state.phase !== "DRAW_GUESS") return;
    const drawLockedAt = reason === "timer" ? this.state.phaseEndsAt : Date.now();
    this.clearTimers();
    const isClosingRound = this.isClosingRound();
    const before = {
      A: this.state.branches[0].score,
      B: this.state.branches[1].score
    };
    const values = {
      A: branchRoundValue(this.state.branches[0], this.state.postageClass, isClosingRound),
      B: branchRoundValue(this.state.branches[1], this.state.postageClass, isClosingRound)
    };
    const forceLockedBranch = shippedBy ? otherBranchId(shippedBy) : undefined;
    const forceLockCutOff: Partial<Record<BranchId, number>> = {};
    if (forceLockedBranch) {
      const locked = getBranch(this.state, forceLockedBranch);
      forceLockCutOff[forceLockedBranch] = eligibleCrewIds(locked).filter((playerId) => {
        if (locked.correctGuessers.includes(playerId)) return false;
        const band = locked.warmthByPlayer[playerId];
        return band === "HIGH" || band === "MEDIUM";
      }).length;
    }

    for (const branch of this.state.branches) {
      branch.locked = true;
      branch.shippedValue = values[branch.id];
    }

    this.state.branches[0].score += values.A;
    this.state.branches[1].score += values.B;
    const winner = roundWinner(values.A, values.B);
    if (winner !== "TIE") {
      getBranch(this.state, winner).roundsWon += 1;
    }

    const revealStartAt = Date.now() + this.scaled(450);
    const payload: ShipRevealPayload = {
      reason,
      shippedBy,
      forceLockedBranch,
      forceLockCutOff,
      revealStartAt,
      sides: [
        {
          branchId: "A",
          branchName: this.state.branches[0].name,
          correctCount: this.state.branches[0].correctGuessers.length,
          eligibleGuessers: G(this.state.branches[0].players.length),
          postageClass: this.state.postageClass,
          stampValue: values.A,
          scoreBefore: before.A,
          scoreAfter: this.state.branches[0].score,
          firstCorrectGuesser: this.nicknameFor(this.state.branches[0].correctGuessers[0]),
          word: this.currentWords.A?.text ?? this.state.branches[0].word ?? "",
          strokes: [...this.state.branches[0].roundStrokeLog]
        },
        {
          branchId: "B",
          branchName: this.state.branches[1].name,
          correctCount: this.state.branches[1].correctGuessers.length,
          eligibleGuessers: G(this.state.branches[1].players.length),
          postageClass: this.state.postageClass,
          stampValue: values.B,
          scoreBefore: before.B,
          scoreAfter: this.state.branches[1].score,
          firstCorrectGuesser: this.nicknameFor(this.state.branches[1].correctGuessers[0]),
          word: this.currentWords.B?.text ?? this.state.branches[1].word ?? "",
          strokes: [...this.state.branches[1].roundStrokeLog]
        }
      ],
      roundWinner: winner,
      isClosingRound
    };

    this.previousPostmasters = { ...this.currentPostmasters };
    this.currentReveal = payload;
    this.currentDrawLockedAt = drawLockedAt;
    this.setPhase("SHIP_REVEAL", 6_500);
    this.emitToMatch("marv", MARV_LINES.ship(shippedBy));
    this.emitToMatch("shipReveal", payload);
    this.telemetry?.append(this.state.id, "round_ended", {
      roundIndex: this.state.roundIndex,
      reason,
      shippedBy,
      values,
      winner,
      forceLockCutOff
    });
    this.telemetry?.metric(this.state.id, "ship_timing", {
      reason,
      shippedBy,
      remainingMs: Math.max(0, this.state.phaseEndsAt - Date.now())
    });
    this.broadcastSnapshots();
    this.schedule(() => this.startRevealHold(), 6_500);
  }

  private startRevealHold(): void {
    this.clearTimers();
    if (this.isFinalRoundComplete()) {
      this.setPhase("REVEAL_HOLD", 5_000);
      this.broadcastSnapshots();
      this.schedule(() => this.finishMatch(), 5_000);
      return;
    }
    this.revealHoldOpenedAt = Date.now();
    this.setPhase("REVEAL_HOLD", TIMERS.REVEAL_HOLD_CAP);
    this.broadcastSnapshots();
    this.schedule(() => this.openBoundaryPrompts(), TIMERS.REVEAL_HOLD_FLOOR);
    this.schedule(() => this.autoBoundaryAndAdvance(), TIMERS.REVEAL_HOLD_CAP);
  }

  private openBoundaryPrompts(): void {
    if (this.state.phase !== "REVEAL_HOLD") return;
    const [a, b] = this.state.branches;
    let classBranch: BranchId;
    let typeBranch: BranchId;
    if (a.score < b.score) {
      classBranch = "A";
      typeBranch = "B";
    } else if (b.score < a.score) {
      classBranch = "B";
      typeBranch = "A";
    } else {
      classBranch = randomItem(["A", "B"] as const, this.rng);
      typeBranch = otherBranchId(classBranch);
    }

    this.createBoundaryPrompt(classBranch, "postageClass");
    this.createBoundaryPrompt(typeBranch, "mailType");
  }

  private createBoundaryPrompt(branchId: BranchId, kind: BoundaryPromptInternal["kind"]): void {
    const prompt: BoundaryPromptInternal = {
      promptId: nanoid(8),
      branchId,
      kind,
      openedAt: Date.now(),
      expiresAt: this.state.phaseEndsAt
    };
    this.pendingBoundary.set(branchId, prompt);
    const branch = getBranch(this.state, branchId);
    const mailman = branch.players.find((player) => player.id === branch.mailmanId);
    if (!mailman || mailman.isBot || !mailman.connected) {
      this.autoPickPrompt(prompt);
      return;
    }
    this.emitToPlayer(mailman.id, "boundaryPrompt", this.boundaryPromptPayload(prompt));
  }

  private boundaryPromptPayload(prompt: BoundaryPromptInternal): BoundaryPromptPayload {
    if (prompt.kind === "postageClass") {
      return {
        promptId: prompt.promptId,
        kind: prompt.kind,
        expiresAt: prompt.expiresAt,
        options: POSTAGE_CLASSES.map((value) => ({
          value,
          label: value.replace("_", " "),
          helper: CLASS_TIER_LABEL[value]
        }))
      };
    }
    return {
      promptId: prompt.promptId,
      kind: prompt.kind,
      expiresAt: prompt.expiresAt,
      options: MAIL_TYPES.map((value) => ({
        value,
        label: MAIL_TYPE_LABEL[value],
        helper: "Sets the next mail article shape and word category."
      }))
    };
  }

  private autoBoundaryAndAdvance(): void {
    if (this.state.phase !== "REVEAL_HOLD") return;
    for (const prompt of [...this.pendingBoundary.values()]) {
      this.autoPickPrompt(prompt);
    }
    if (this.pendingBoundary.size === 0) {
      this.emitToMatch("marv", MARV_LINES.autoBoundary());
      this.advanceAfterReveal();
    }
  }

  private autoPickPrompt(prompt: BoundaryPromptInternal): void {
    if (prompt.kind === "postageClass") {
      this.nextTerms.postageClass = randomItem(POSTAGE_CLASSES, this.rng);
    } else {
      this.nextTerms.mailType = randomItem(MAIL_TYPES, this.rng);
    }
    this.telemetry?.append(this.state.id, "boundary_auto_pick", {
      branchId: prompt.branchId,
      kind: prompt.kind,
      choice: prompt.kind === "postageClass" ? this.nextTerms.postageClass : this.nextTerms.mailType
    });
    this.pendingBoundary.delete(prompt.branchId);
  }

  private advanceAfterReveal(): void {
    if (this.state.phase !== "REVEAL_HOLD") return;
    this.clearTimers();
    this.discardRoundStrokes();
    const nextRoundIndex = this.state.roundIndex + 1;
    if (nextRoundIndex >= this.totalRounds()) {
      this.finishMatch();
      return;
    }
    if (this.shouldRunScrambleBefore(nextRoundIndex)) {
      this.nextRoundAfterScramble = nextRoundIndex;
      this.startScramble();
      return;
    }
    this.state.roundIndex = nextRoundIndex;
    this.startRound();
  }

  private startScramble(): void {
    this.clearTimers();
    const introMs = TIMERS.SCRAMBLE_BRIEFING;
    this.setPhase("SCRAMBLE", TIMERS.SCRAMBLE, {
      kind: "SCRAMBLE_START",
      title: "Midday Spill",
      subtitle: "Special Delivery sort",
      body: "Sort each mail piece into the matching bin. Correct sorts add points; misses subtract.",
      durationMs: introMs
    });
    this.scramble = createScramble(this.state.branches.flatMap((branch) => branch.players), this.state.phaseEndsAt, this.rng);
    this.emitToMatch("marv", MARV_LINES.scrambleStart());
    this.emitToMatch("scrambleState", scrambleState(this.scramble, this.state.phaseEndsAt));
    this.broadcastSnapshots();
    this.telemetry?.append(this.state.id, "scramble_started", { roundIndex: this.state.roundIndex });
    this.scheduleSoloScrambleSorts(introMs);
    this.schedule(() => this.endScramble(), introMs + TIMERS.SCRAMBLE);
  }

  private scheduleSoloManifestRanks(introMs = 0): void {
    if (!this.soloPlaytest || this.state.phase !== "MANIFEST") return;
    for (const branch of this.state.branches) {
      const postmaster = branch.players.find((player) => player.id === branch.postmasterId);
      if (!postmaster?.isBot) continue;
      this.schedule(() => {
        if (this.state.phase !== "MANIFEST") return;
        this.submitManifestRank(postmaster.id, botManifestOrder(this.manifestCandidates, this.rng));
      }, introMs + 350 + Math.floor(this.rng() * 650));
    }
  }

  private scheduleSoloDrawGuess(introMs = 0): void {
    if (!this.soloPlaytest || this.state.phase !== "DRAW_GUESS") return;
    const drawDuration = Math.max(1, this.drawGuessDurationMs);
    this.scheduleSoloChatter(drawDuration, introMs);
    const soloPlayer = findPlayer(this.state, this.soloPlaytest.playerId);
    if (soloPlayer && roleFor(this.state, soloPlayer.id) === "CREW") {
      const branch = getBranch(this.state, soloPlayer.branchId);
      const postmaster = branch.players.find((player) => player.id === branch.postmasterId);
      const word = this.currentWords[branch.id]?.text ?? branch.word;
      if (postmaster?.isBot && word) {
        this.emitToPlayer(
          soloPlayer.id,
          "marv",
          marv("flow", `Solo clue: bot Postmaster is standing in for drawing. The word is ${word.toUpperCase()}.`, "player")
        );
      }
    }

    for (const branch of this.state.branches) {
      const word = this.currentWords[branch.id]?.text ?? branch.word;
      if (!word) continue;
      const eligible = eligibleCrewIds(branch)
        .map((playerId) => branch.players.find((player) => player.id === playerId))
        .filter((player): player is Player => Boolean(player));

      for (const guesser of eligible) {
        if (!guesser.isBot) continue;
        const correctDelay = sampledCorrectTime(drawDuration, this.rng);
        if (this.rng() < 0.55) {
          this.schedule(() => {
            if (this.state.phase === "DRAW_GUESS") this.submitGuess(guesser.id, this.soloWrongGuess(word));
          }, introMs + Math.max(250, correctDelay - 2_400));
        }
        this.schedule(() => {
          if (this.state.phase === "DRAW_GUESS") this.submitGuess(guesser.id, word);
        }, introMs + correctDelay);
      }

      const mailman = branch.players.find((player) => player.id === branch.mailmanId);
      if (mailman?.isBot) {
        this.schedule(() => {
          if (this.state.phase === "DRAW_GUESS") this.ship(mailman.id);
        }, introMs + Math.round(drawDuration * 0.72 + this.rng() * drawDuration * 0.12));
      }
    }
  }

  private scheduleSoloScrambleSorts(introMs = 0): void {
    if (!this.soloPlaytest || !this.scramble) return;
    for (const piece of this.scramble.pieces) {
      const player = piece.assignedTo ? findPlayer(this.state, piece.assignedTo) : undefined;
      if (!player?.isBot) continue;
      this.schedule(() => {
        if (this.state.phase === "SCRAMBLE" && this.scramble) {
          this.scrambleSort(player.id, piece.id, piece.type);
        }
      }, introMs + 250 + Math.floor(this.rng() * 2_500));
    }
  }

  private soloWrongGuess(word: string): string {
    const clean = normalizeGuess(word).replace(/\s/g, "");
    if (clean.length <= 3) return "mail";
    const rotated = `${clean.slice(1)}${clean[0] ?? ""}`;
    if (rotated !== clean) return rotated;
    return `${clean.slice(0, -1)}x`;
  }

  private scheduleSoloChatter(drawDurationMs: number, introMs = 0): void {
    if (!this.soloPlaytest) return;
    const soloPlayer = findPlayer(this.state, this.soloPlaytest.playerId);
    if (!soloPlayer) return;
    const ownBranch = getBranch(this.state, soloPlayer.branchId);
    const opponentBranch = getBranch(this.state, otherBranchId(soloPlayer.branchId));
    const ownBots = this.botPlayers(ownBranch).slice(0, 3);
    const opponentBots = this.botPlayers(opponentBranch).slice(0, 2);
    const maxWindow = Math.max(1_200, drawDurationMs * 0.52);

    ownBots.forEach((bot, index) => {
      this.schedule(
        () => this.emitSoloBotChat(soloPlayer.id, bot, this.soloBotLine(ownBranch.id, false)),
        introMs + 700 + index * 1_250 + Math.floor(this.rng() * 700)
      );
      this.schedule(
        () => this.emitSoloBotEmoji(soloPlayer.id, bot),
        introMs + 1_300 + index * 1_450 + Math.floor(this.rng() * 900)
      );
    });

    opponentBots.forEach((bot, index) => {
      this.schedule(
        () => this.emitSoloBotChat(soloPlayer.id, bot, this.soloBotLine(opponentBranch.id, true)),
        introMs + 1_200 + index * 1_500 + Math.floor(this.rng() * Math.min(1_600, maxWindow))
      );
      this.schedule(
        () => this.emitSoloBotEmoji(soloPlayer.id, bot),
        introMs + 2_300 + index * 1_650 + Math.floor(this.rng() * Math.min(1_700, maxWindow))
      );
    });
  }

  private emitSoloBotChat(recipientId: string, bot: Player, text: string): void {
    if (!this.soloPlaytest || this.state.phase !== "DRAW_GUESS") return;
    this.emitToPlayer(recipientId, "chatBroadcast", {
      id: nanoid(8),
      playerId: bot.id,
      playerName: bot.nickname,
      text,
      ts: Date.now()
    } satisfies ChatEntryPayload);
    this.telemetry?.append(this.state.id, "solo_bot_chat", { playerId: bot.id, branchId: bot.branchId, length: text.length });
  }

  private emitSoloBotEmoji(recipientId: string, bot: Player): void {
    if (!this.soloPlaytest || this.state.phase !== "DRAW_GUESS") return;
    const emojiId = randomItem(EMOJI_IDS, this.rng);
    this.emitToPlayer(recipientId, "emoji", {
      id: nanoid(8),
      playerId: bot.id,
      playerName: bot.nickname,
      emojiId,
      ts: Date.now()
    } satisfies EmojiPayload);
    this.telemetry?.append(this.state.id, "solo_bot_emoji", { playerId: bot.id, branchId: bot.branchId, emojiId });
  }

  private soloBotLine(branchId: BranchId, opponent: boolean): string {
    const lines = opponent
      ? [
          "Their counter is getting noisy.",
          "Opponent branch says they are close.",
          "Rival sorter reports a confident guess.",
          "Other branch is celebrating something."
        ]
      : [
          "I'm watching the clue window.",
          "That shape is starting to make sense.",
          "Our branch is warming up.",
          "Hold the route, I have a hunch."
        ];
    return `[${branchId}] ${randomItem(lines, this.rng)}`;
  }

  private botPlayers(branch: Branch): Player[] {
    return branch.players.filter((player) => player.isBot);
  }

  private endScramble(): void {
    if (!this.scramble) return;
    this.clearTimers();
    const result = scrambleResult(this.scramble);
    this.state.branches[0].scrambleScore = result.scores.A;
    this.state.branches[1].scrambleScore = result.scores.B;
    this.scramble = undefined;
    this.setPhase("SCRAMBLE", TIMERS.SCRAMBLE_RESULT);
    this.emitToMatch("scrambleResult", result);
    this.broadcastSnapshots();
    this.telemetry?.append(this.state.id, "scramble_ended", result);
    const next = this.nextRoundAfterScramble ?? this.state.roundIndex + 1;
    this.nextRoundAfterScramble = undefined;
    this.schedule(() => {
      this.state.roundIndex = next;
      this.startRound();
    }, TIMERS.SCRAMBLE_RESULT);
  }

  private finishMatch(): void {
    this.clearTimers();
    this.discardRoundStrokes();
    const resolved = resolveMatchWinner(this.state);
    const payload: MatchEndPayload = {
      winner: resolved.winner,
      reason: resolved.reason,
      finalScores: {
        A: this.state.branches[0].score,
        B: this.state.branches[1].score
      },
      roundsWon: {
        A: this.state.branches[0].roundsWon,
        B: this.state.branches[1].roundsWon
      },
      scrambleScores: {
        A: this.state.branches[0].scrambleScore,
        B: this.state.branches[1].scrambleScore
      },
      awards: this.createAwards()
    };
    this.setPhase("MATCH_END", 0);
    this.emitToMatch("marv", MARV_LINES.matchEnd());
    this.emitToMatch("matchEnd", payload);
    this.telemetry?.append(this.state.id, "match_ended", payload);
    this.broadcastSnapshots();
  }

  private createAwards(): MatchEndPayload["awards"] {
    const players = this.state.branches.flatMap((branch) => branch.players).filter((player) => !player.isBot);
    const titles = ["Employee of the Month", "Best Dispatcher", "Manifest Master", "Sorting Savant"];
    return players.slice(0, titles.length).map((player, index) => ({
      playerId: player.id,
      playerName: player.nickname,
      title: titles[index] ?? "Postal Pro",
      detail: "MARV found this badge in a perfectly legitimate drawer."
    }));
  }

  private emitGuessPublic(
    branch: Branch,
    player: Player,
    text: string,
    correct: boolean,
    word: WordEntry,
    normalizedGuess: string
  ): void {
    for (const recipient of this.state.branches.flatMap((entry) => entry.players)) {
      if (recipient.isBot || !recipient.connected) continue;
      const role = roleFor(this.state, recipient.id);
      if (role === "POSTMASTER" || role === "INSPECTOR") continue;
      const sameBranch = recipient.branchId === branch.id;
      const shouldMask = !sameBranch || role === "MAILMAN";
      const visibleText = shouldMask
        ? undefined
        : sameBranch
          ? correct
            ? recipient.id === player.id
              ? text
              : undefined
            : text
          : undefined;
      const mask = shouldMask
        ? createGuessMask(normalizedGuess, word, correct)
        : undefined;
      const payload: GuessPublicPayload = {
        playerId: player.id,
        playerName: player.nickname,
        label: correct ? "correct" : "wrong",
        text: visibleText,
        mask
      };
      this.emitToPlayer(recipient.id, "guessPublic", payload);
    }
  }

  private emitWarmth(branch: Branch, guesserId: string): void {
    const eligible = eligibleCrewIds(branch);
    const mailman = branch.players.find((player) => player.id === branch.mailmanId);
    this.emitToPlayer(guesserId, "warmth", { own: branch.warmthByPlayer[guesserId] ?? "LOW" });
    if (mailman && !mailman.isBot && mailman.connected) {
      this.emitToPlayer(mailman.id, "warmth", {
        summary: summarizeWarmth(branch.warmthByPlayer, branch.previousWarmthBand, eligible)
      });
    }
  }

  private requireRoleAndPhase(playerId: string, role: ReturnType<typeof roleFor>, phase: Phase): boolean {
    if (!this.requireRole(playerId, role)) return false;
    if (this.state.phase !== phase) {
      this.emitError(playerId, "PHASE_FORBIDDEN", "That action is not open on this part of the route.");
      return false;
    }
    return true;
  }

  private requirePhaseActive(playerId: string): boolean {
    const now = Date.now();
    if (now < this.state.phaseStartedAt) {
      this.emitError(playerId, "PHASE_BRIEFING", "MARV is still briefing this route.");
      return false;
    }
    if (this.state.phaseEndsAt > this.state.phaseStartedAt && now > this.state.phaseEndsAt) {
      this.emitError(playerId, "PHASE_LOCKED", "That station is already locked.");
      return false;
    }
    return true;
  }

  private requireStrokePhaseActive(playerId: string, stroke: Stroke): boolean {
    const now = Date.now();
    if (now < this.state.phaseStartedAt) {
      this.emitError(playerId, "PHASE_BRIEFING", "MARV is still briefing this route.");
      return false;
    }
    if (this.state.phaseEndsAt <= this.state.phaseStartedAt || now <= this.state.phaseEndsAt) return true;

    const startedAt = stroke.startedAt ?? now;
    const graceEndsAt = this.state.phaseEndsAt + this.scaled(DRAW_STROKE_GRACE_MS);
    if (startedAt <= this.state.phaseEndsAt && now <= graceEndsAt) return true;

    this.emitError(playerId, "PHASE_LOCKED", "That station is already locked.");
    return false;
  }

  private acceptLateStroke(playerId: string, stroke: Stroke): boolean {
    if (!this.currentReveal || !this.currentDrawLockedAt) return false;
    if (this.state.phase !== "SHIP_REVEAL" && this.state.phase !== "REVEAL_HOLD") return false;

    const now = Date.now();
    const startedAt = stroke.startedAt ?? now;
    if (startedAt > this.currentDrawLockedAt) return false;
    if (now > this.currentDrawLockedAt + this.scaled(DRAW_STROKE_GRACE_MS)) return false;

    const branch = this.appendStroke(playerId, stroke);
    if (!branch) return false;
    const side = this.currentReveal.sides.find((candidate) => candidate.branchId === branch.id);
    if (side && !side.strokes.some((entry) => entry.id === stroke.id)) side.strokes.push(stroke);
    this.emitToMatch("shipReveal", this.currentReveal);
    this.broadcastSnapshots();
    return true;
  }

  private requireRole(playerId: string, role: ReturnType<typeof roleFor>): boolean {
    if (roleFor(this.state, playerId) !== role) {
      this.emitError(playerId, "ROLE_FORBIDDEN", "MARV checked the badge; this station is not yours.");
      return false;
    }
    return true;
  }

  private nicknameFor(playerId?: string): string | undefined {
    if (!playerId) return undefined;
    return findPlayer(this.state, playerId)?.nickname;
  }

  private isClosingRound(): boolean {
    return this.state.roundIndex === this.totalRounds() - 1;
  }

  private isFinalRoundComplete(): boolean {
    return this.state.roundIndex >= this.totalRounds() - 1;
  }

  private totalRounds(): number {
    return Math.max(1, this.state.cyclesTotal * this.roundsPerCycle());
  }

  private roundsPerCycle(): number {
    return Math.max(1, Math.min(this.state.branches[0].players.length, this.state.branches[1].players.length));
  }

  private shouldRunScrambleBefore(nextRoundIndex: number): boolean {
    return this.state.cyclesTotal >= 2 && nextRoundIndex === Math.floor(this.totalRounds() / 2);
  }

  private discardRoundStrokes(): void {
    for (const branch of this.state.branches) {
      branch.roundStrokeLog = [];
    }
  }

  private setPhase(phase: Phase, durationMs: number, intro?: PhaseIntroInput): void {
    const now = Date.now();
    const introDuration = intro ? this.scaled(intro.durationMs) : 0;
    this.state.phase = phase;
    this.state.phaseStartedAt = now + introDuration;
    this.state.phaseEndsAt = this.state.phaseStartedAt + this.scaled(durationMs);
    this.phaseIntro = intro && introDuration > 0
      ? {
          id: nanoid(8),
          kind: intro.kind,
          title: intro.title,
          subtitle: intro.subtitle,
          body: intro.body,
          startsAt: now,
          endsAt: now + introDuration
        }
      : undefined;
  }

  private schedule(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, this.scaled(ms));
    this.timers.add(timer);
  }

  private scheduleWordHintBroadcasts(introMs = 0): void {
    for (let tick = 1; tick <= WORD_HINT_TICKS; tick += 1) {
      this.schedule(() => {
        if (this.state.phase === "DRAW_GUESS") this.broadcastSnapshots();
      }, introMs + this.drawGuessDurationMs * (0.2 + (0.7 * tick) / WORD_HINT_TICKS));
    }
  }

  private currentPhaseIntro(): PhaseIntroPayload | undefined {
    if (!this.phaseIntro || this.phaseIntro.endsAt <= Date.now()) return undefined;
    return this.phaseIntro;
  }

  private scaled(ms: number): number {
    return Math.max(0, Math.round(ms * this.timerScale));
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private emitLobbyState(): void {
    this.emitToMatch("lobbyState", this.lobbyState());
  }

  private broadcastRoundStart(): void {
    for (const player of this.state.branches.flatMap((branch) => branch.players)) {
      if (player.isBot || !player.connected) continue;
      this.emitToPlayer(player.id, "roundStart", {
        snapshot: this.snapshotFor(player.id),
        roles: {
          A: {
            postmasterId: this.state.branches[0].postmasterId,
            mailmanId: this.state.branches[0].mailmanId
          },
          B: {
            postmasterId: this.state.branches[1].postmasterId,
            mailmanId: this.state.branches[1].mailmanId
          }
        },
        manifestCandidates: roleFor(this.state, player.id) === "POSTMASTER" ? this.manifestCandidates : undefined
      });
    }
    this.broadcastSnapshots();
  }

  private broadcastSnapshots(): void {
    for (const player of this.state.branches.flatMap((branch) => branch.players)) {
      if (!player.isBot && player.connected) this.emitState(player.id);
    }
  }

  private emitState(playerId: string): void {
    this.emitToPlayer(playerId, "state", this.snapshotFor(playerId));
  }

  private emitError(playerId: string, code: string, message: string): void {
    this.emitToPlayer(playerId, "error", { code, message });
  }

  private emitToMatch(event: RuntimeEventName, payload: unknown): void {
    this.emitSink?.({ matchId: this.state.id, target: { scope: "match" }, event, payload });
  }

  private emitToBranch(branchId: BranchId, event: RuntimeEventName, payload: unknown): void {
    this.emitSink?.({ matchId: this.state.id, target: { scope: "branch", branchId }, event, payload });
  }

  private emitToPlayer(playerId: string, event: RuntimeEventName, payload: unknown): void {
    this.emitSink?.({ matchId: this.state.id, target: { scope: "player", playerId }, event, payload });
  }
}

export class MatchRegistry {
  private readonly matchesByCode = new Map<string, MatchRuntime>();
  private readonly playerToMatch = new Map<string, MatchRuntime>();

  constructor(private readonly options: Omit<MatchRuntimeOptions, "code"> = {}) {}

  create(nickname: string): { match: MatchRuntime; player: Player } {
    let code = "";
    do {
      code = ROOM_CODE();
    } while (this.matchesByCode.has(code));
    const match = new MatchRuntime({ ...this.options, code });
    this.matchesByCode.set(code, match);
    return this.addPlayerToMatch(match, nickname);
  }

  join(code: string | undefined, nickname: string): { match: MatchRuntime; player: Player } | undefined {
    const normalized = normalizeRoomCode(code);
    if (!normalized) return undefined;
    const match = this.matchesByCode.get(normalized);
    if (!match) return undefined;
    return this.addPlayerToMatch(match, nickname);
  }

  resume(code: string | undefined, playerId: string | undefined): { match: MatchRuntime; player: Player } | undefined {
    const normalized = normalizeRoomCode(code);
    if (!normalized || !playerId) return undefined;
    const match = this.matchesByCode.get(normalized);
    if (!match) return undefined;
    const player = findPlayer(match.state, playerId);
    if (!player || player.isBot) return undefined;
    this.playerToMatch.set(player.id, match);
    return { match, player };
  }

  private addPlayerToMatch(match: MatchRuntime, nickname: string): { match: MatchRuntime; player: Player } {
    const player = match.addPlayer(nickname);
    this.playerToMatch.set(player.id, match);
    return { match, player };
  }

  byPlayer(playerId: string): MatchRuntime | undefined {
    return this.playerToMatch.get(playerId);
  }

  byCode(code: string): MatchRuntime | undefined {
    return this.matchesByCode.get(normalizeRoomCode(code));
  }
}

export function createGuessMask(
  normalizedGuess: string,
  word: Pick<WordEntry, "text">,
  correct: boolean
): GuessMaskCell[] {
  const guess = normalizedGuess || " ";
  if (correct) {
    return [...guess].map((character) => ({ kind: character === " " ? "space" : "correct" }));
  }

  const targetCharacters = [...normalizeGuess(word.text).replace(/\s/g, "")];
  const guessCharacters = [...guess];
  const output = new Array<GuessMaskCell | undefined>(guessCharacters.length);
  let targetIndex = 0;

  for (let index = 0; index < guessCharacters.length; index += 1) {
    const character = guessCharacters[index];
    if (character === " ") {
      output[index] = { kind: "space" };
      continue;
    }
    if (character === targetCharacters[targetIndex]) {
      output[index] = { kind: "correct" };
      targetCharacters[targetIndex] = "";
    }
    targetIndex += 1;
  }

  const remaining = new Map<string, number>();
  for (const character of targetCharacters) {
    if (!character) continue;
    remaining.set(character, (remaining.get(character) ?? 0) + 1);
  }

  for (let index = 0; index < guessCharacters.length; index += 1) {
    if (output[index]) continue;
    const character = guessCharacters[index];
    if (!character) continue;
    const count = remaining.get(character) ?? 0;
    if (count > 0) {
      output[index] = { kind: "present" };
      remaining.set(character, count - 1);
    } else {
      output[index] = { kind: "miss" };
    }
  }

  return output.map((cell) => cell ?? { kind: "miss" });
}

function clampTimerSeconds(seconds: number): number {
  return Math.max(30, Math.min(120, Math.round(seconds)));
}

function normalizeRoomCode(code: string | undefined): string {
  return code?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}
