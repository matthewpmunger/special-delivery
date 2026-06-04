"use client";

import { ClipboardList, Mail, MessageCircle, Pencil, Send, ShieldCheck, Smile, UsersRound } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Role } from "@special-delivery/shared";
import type { BoundaryPromptPayload, GuessMaskCell } from "@special-delivery/shared/events";
import { useGameStore } from "../store";
import { usePhaseActive } from "../usePhaseActive";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

const EMOJIS = [
  { id: "stamp", label: "Stamp", codePoint: 0x1f4ee },
  { id: "eyes", label: "Eyes", codePoint: 0x1f440 },
  { id: "spark", label: "Spark", codePoint: 0x2728 },
  { id: "panic", label: "Panic", codePoint: 0x1f631 },
  { id: "hold", label: "Hold", codePoint: 0x270b },
  { id: "ship", label: "Ship", codePoint: 0x1f69a }
] as const;

const EMOJI_BY_ID: ReadonlyMap<string, (typeof EMOJIS)[number]> = new Map(EMOJIS.map((item) => [item.id, item]));
const AVATAR_COLORS = [
  "#8f3f71",
  "#b84f3f",
  "#a3631f",
  "#7c4bb0",
  "#c24d7d",
  "#9d4b2d",
  "#b86a00",
  "#7d3f8f",
  "#bf4b5b",
  "#8f5a2a"
];
const FALLBACK_AVATAR_COLOR = "#8f3f71";
const STICKY_SCROLL_THRESHOLD = 48;
const CHAT_FOCUS_RETRY_DELAYS = [0, 80, 180, 360, 720] as const;

function emojiGlyph(id: string): string {
  return String.fromCodePoint(EMOJI_BY_ID.get(id)?.codePoint ?? 0x2753);
}

function emojiLabel(id: string): string {
  return EMOJI_BY_ID.get(id)?.label ?? id.toUpperCase();
}

function initialsForName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function GuessMask({ mask }: { mask: GuessMaskCell[] }) {
  return (
    <div aria-label="Obfuscated guess heatmap" className="guess-mask" role="img">
      {mask.map((cell, index) => (
        <div aria-hidden="true" className={`guess-mask-cell ${cell.kind}`} key={`${cell.kind}-${index}`} />
      ))}
    </div>
  );
}

function roleLabel(role: Role): string {
  return role.toLowerCase().replace(/(^|_)([a-z])/g, (_, separator: string, letter: string) =>
    `${separator ? " " : ""}${letter.toUpperCase()}`
  );
}

function roleDescription(role: Role): string {
  if (role === "POSTMASTER") return "Draw the manifest word.";
  if (role === "MAILMAN") return "Watch the route and ship at the right moment.";
  if (role === "INSPECTOR") return "Monitor both stations.";
  return "Guess, react, and keep the branch moving.";
}

function RoleIcon({ role }: { role: Role }) {
  if (role === "POSTMASTER") return <Pencil size={24} />;
  if (role === "MAILMAN") return <Mail size={24} />;
  if (role === "INSPECTOR") return <ShieldCheck size={24} />;
  return <UsersRound size={24} />;
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <div className={`chat-role-badge role-${role.toLowerCase()}`}>
      <div className="chat-role-icon">
        <RoleIcon role={role} />
      </div>
      <div>
        <span>Your role</span>
        <strong>{roleLabel(role)}</strong>
        <small>{roleDescription(role)}</small>
      </div>
    </div>
  );
}

function BoundaryAction({
  onPick,
  prompt
}: {
  onPick: (choice: BoundaryPromptPayload["options"][number]["value"]) => void;
  prompt: BoundaryPromptPayload;
}) {
  const title = prompt.kind === "postageClass" ? "Choose the next timer class" : "Choose the next mail type";
  return (
    <div className="boundary-action-panel">
      <div className="boundary-action-copy">
        <span>Route decision</span>
        <strong>{title}</strong>
      </div>
      <div className="boundary-option-grid">
        {prompt.options.map((option) => (
          <button
            className="secondary-button boundary-option-button"
            key={option.value}
            onClick={() => onPick(option.value)}
            title={option.helper}
            type="button"
          >
            <ClipboardList size={16} />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function isNearTimelineBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - node.clientHeight - node.scrollTop <= STICKY_SCROLL_THRESHOLD;
}

export function Chat() {
  const snapshot = useGameStore((state) => state.snapshot);
  const timeline = useGameStore((state) => state.timeline);
  const emojis = useGameStore((state) => state.emojis);
  const chat = useGameStore((state) => state.chat);
  const guess = useGameStore((state) => state.guess);
  const emoji = useGameStore((state) => state.emoji);
  const ship = useGameStore((state) => state.ship);
  const boundaryPrompt = useGameStore((state) => state.boundaryPrompt);
  const boundaryPick = useGameStore((state) => state.boundaryPick);
  const [text, setText] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [chatInputFocused, setChatInputFocused] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const chatFocusFrameRef = useRef<number | null>(null);
  const chatFocusTimerRef = useRef<number | null>(null);
  const activePhase = usePhaseActive(snapshot);
  const canChat = snapshot?.role === "CREW";
  const canEmoji = snapshot?.role === "CREW" || snapshot?.role === "MAILMAN";
  const canGuess =
    snapshot?.role === "CREW" &&
    snapshot.phase === "DRAW_GUESS" &&
    activePhase &&
    !snapshot.ownBranch.correctGuessers.includes(snapshot.playerId);
  const showShipControl = snapshot?.role === "MAILMAN" && snapshot.phase === "DRAW_GUESS";
  const showBoundaryControl = snapshot?.role === "MAILMAN" && snapshot.phase === "REVEAL_HOLD" && Boolean(boundaryPrompt);
  const showEmojiOnlyControl = canEmoji && !canChat && !showShipControl && !showBoundaryControl;
  const canShip = Boolean(showShipControl && activePhase);
  const ownTeamIds = useMemo(
    () => new Set(snapshot?.ownBranch.players.map((player) => player.id) ?? []),
    [snapshot?.ownBranch.players]
  );
  const feed = useMemo(
    () =>
      [
        ...timeline,
        ...emojis.map((entry) => ({
          ...entry,
          kind: "emoji" as const
        }))
      ].sort((a, b) => a.ts - b.ts),
    [emojis, timeline]
  );
  const avatarColors = useMemo(() => {
    const playerKeys = new Set<string>();
    for (const entry of feed) {
      if (entry.kind === "marv") continue;
      playerKeys.add(entry.playerId ?? entry.playerName);
    }
    const assigned = new Map<string, string>();
    const used = new Set<string>();
    for (const key of [...playerKeys].sort()) {
      const start = hashString(key) % AVATAR_COLORS.length;
      let color = AVATAR_COLORS[start] ?? FALLBACK_AVATAR_COLOR;
      for (let offset = 0; offset < AVATAR_COLORS.length; offset += 1) {
        const candidate = AVATAR_COLORS[(start + offset) % AVATAR_COLORS.length] ?? color;
        if (!used.has(candidate)) {
          color = candidate;
          break;
        }
      }
      used.add(color);
      assigned.set(key, color);
    }
    return assigned;
  }, [feed]);
  const scrollKey = `${feed.length}:${snapshot?.phase ?? ""}:${snapshot?.role ?? ""}`;

  const scrollToBottom = useCallback(() => {
    const node = timelineRef.current;
    if (!node) return;
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    shouldStickToBottomRef.current = true;
  }, []);

  const focusChatInput = useCallback(() => {
    const input = chatInputRef.current;
    if (!input || input.disabled) return;
    if (!input.offsetParent) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const focusChatInputSoon = useCallback(() => {
    if (!canChat) return;
    focusChatInput();
    if (chatFocusFrameRef.current) {
      window.cancelAnimationFrame(chatFocusFrameRef.current);
    }
    if (chatFocusTimerRef.current) {
      window.clearTimeout(chatFocusTimerRef.current);
    }
    chatFocusFrameRef.current = window.requestAnimationFrame(() => {
      focusChatInput();
      chatFocusFrameRef.current = null;
    });
    chatFocusTimerRef.current = window.setTimeout(() => {
      focusChatInput();
      chatFocusTimerRef.current = null;
    }, 80);
  }, [canChat, focusChatInput]);

  const scheduleScrollToBottom = useCallback(
    (settle = false) => {
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollToBottom();
        scrollFrameRef.current = null;
      });
      if (settle) {
        if (scrollSettleTimerRef.current) {
          window.clearTimeout(scrollSettleTimerRef.current);
        }
        scrollSettleTimerRef.current = window.setTimeout(() => {
          scrollToBottom();
          scrollSettleTimerRef.current = null;
        }, 90);
      }
    },
    [scrollToBottom]
  );

  useLayoutEffect(() => {
    const node = timelineRef.current;
    if (!node) return;
    if (shouldStickToBottomRef.current || isNearTimelineBottom(node)) {
      scheduleScrollToBottom(true);
    }
  }, [scrollKey, scheduleScrollToBottom]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) return;
    const handleScroll = () => {
      shouldStickToBottomRef.current = isNearTimelineBottom(node);
    };
    handleScroll();
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current || isNearTimelineBottom(node)) {
        scheduleScrollToBottom();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (scrollSettleTimerRef.current) {
        window.clearTimeout(scrollSettleTimerRef.current);
      }
      if (chatFocusFrameRef.current) {
        window.cancelAnimationFrame(chatFocusFrameRef.current);
      }
      if (chatFocusTimerRef.current) {
        window.clearTimeout(chatFocusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canEmoji) setEmojiPickerOpen(false);
  }, [canEmoji]);

  useEffect(() => {
    if (!canChat) return;
    let focusFrame: number | null = null;
    const focusTimers = CHAT_FOCUS_RETRY_DELAYS.map((delay) =>
      window.setTimeout(() => {
        focusFrame = window.requestAnimationFrame(focusChatInput);
      }, delay)
    );
    const handleWindowFocus = () => focusChatInput();
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      if (focusFrame) window.cancelAnimationFrame(focusFrame);
      focusTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [
    canChat,
    focusChatInput,
    snapshot?.matchId,
    snapshot?.phase,
    snapshot?.phaseStartedAt,
    snapshot?.playerId,
    snapshot?.role,
    snapshot?.roundIndex
  ]);

  const sendEmoji = useCallback(
    (emojiId: string) => {
      emoji(emojiId);
      setEmojiPickerOpen(false);
      focusChatInputSoon();
    },
    [emoji, focusChatInputSoon]
  );

  useEffect(() => {
    if (!canEmoji) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        playCue("ui-click");
        setEmojiPickerOpen((open) => !open);
        focusChatInputSoon();
        return;
      }
      if (event.key === "Escape" && emojiPickerOpen) {
        event.preventDefault();
        setEmojiPickerOpen(false);
        focusChatInputSoon();
        return;
      }
      if (!emojiPickerOpen || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const emojiIndex = Number(event.key) - 1;
      const pickedEmoji = EMOJIS[emojiIndex];
      if (!pickedEmoji) return;
      event.preventDefault();
      sendEmoji(pickedEmoji.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEmoji, emojiPickerOpen, focusChatInputSoon, sendEmoji]);

  const controlClass = canChat
    ? "has-chat-controls"
    : showBoundaryControl
      ? "has-boundary-control"
      : showShipControl
        ? "has-ship-control"
        : showEmojiOnlyControl
          ? "has-emoji-controls"
          : "no-controls";

  useGsapAnimation(panelRef, [snapshot?.role, snapshot?.phase], (gsap) => {
    gsap.fromTo(
      ".chat-role-badge",
      { autoAlpha: 0, x: -12, scale: 0.98 },
      { autoAlpha: 1, x: 0, scale: 1, duration: 0.3, ease: "back.out(1.4)" }
    );
  });

  useGsapAnimation(panelRef, [feed.length], (gsap) => {
    gsap.fromTo(
      ".timeline .chat-message:last-child",
      { autoAlpha: 0, y: 12, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: "power3.out" }
    );
  });

  useGsapAnimation(panelRef, [controlClass, boundaryPrompt?.promptId], (gsap) => {
    gsap.fromTo(
      ".chat-input-row, .role-action-row, .emoji-only-row",
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.24, ease: "power3.out" }
    );
  });

  const renderEmojiToggle = (className = "") => (
    <button
      aria-expanded={emojiPickerOpen}
      aria-label={emojiPickerOpen ? "Hide emoji reactions" : "Show emoji reactions"}
      className={`secondary-button emoji-toggle-button keytip-button${emojiPickerOpen ? " active" : ""}${className ? ` ${className}` : ""}`}
      data-shortcut="Shift E"
      onClick={() => {
        playCue("ui-click");
        setEmojiPickerOpen((open) => !open);
        focusChatInputSoon();
      }}
      type="button"
    >
      <Smile size={17} />
    </button>
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canChat || !text.trim()) return;
    playCue("chat-send");
    if (canGuess) {
      guess(text);
    } else {
      chat(text);
    }
    setText("");
    focusChatInput();
    shouldStickToBottomRef.current = true;
    scheduleScrollToBottom(true);
  }

  function playerMessageClass(playerId?: string, extraClass = ""): string {
    const isCurrentPlayer = playerId === snapshot?.playerId;
    const isOwnTeam = Boolean(playerId && ownTeamIds.has(playerId));
    const alignmentClass = isCurrentPlayer ? "message-right" : "message-left";
    const teamClass = !playerId || isOwnTeam ? "message-team" : "message-opponent";
    return ["chat-message", alignmentClass, teamClass, extraClass].filter(Boolean).join(" ");
  }

  function playerBubbleClass(playerId?: string, extraClass = ""): string {
    const isOwnTeam = Boolean(playerId && ownTeamIds.has(playerId));
    const teamClass = !playerId || isOwnTeam ? "bubble-team" : "bubble-opponent";
    return ["bubble", teamClass, extraClass].filter(Boolean).join(" ");
  }

  function renderPlayerMessage({
    children,
    extraClass = "",
    id,
    playerId,
    playerName,
    reaction
  }: {
    children: ReactNode;
    extraClass?: string;
    id: string;
    playerId?: string;
    playerName: string;
    reaction?: string;
  }) {
    const playerKey = playerId ?? playerName;
    return (
      <div className={[playerMessageClass(playerId, extraClass), reaction ? "has-reaction" : ""].filter(Boolean).join(" ")} key={id}>
        <div className="message-name">{playerName}</div>
        <div className="message-body">
          <span
            aria-hidden="true"
            className="message-avatar"
            style={{ backgroundColor: avatarColors.get(playerKey) ?? FALLBACK_AVATAR_COLOR }}
          >
            {initialsForName(playerName)}
          </span>
          <div className="message-bubble-wrap">
            <div className={playerBubbleClass(playerId, extraClass)}>{children}</div>
            {reaction ? (
              <span aria-label={reaction === "🏆" ? "Correct guess" : "Wrong guess"} className="guess-reaction">
                {reaction}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderMarvMessage(entry: Extract<(typeof feed)[number], { kind: "marv" }>) {
    return (
      <div className="chat-message message-left marv-message" key={entry.id}>
        <div className="message-name">MARV</div>
        <div className="message-body">
          <span aria-hidden="true" className="message-avatar marv-avatar">
            🤖
          </span>
          <div className="message-bubble-wrap">
            <div className="bubble marv">{entry.text}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`panel stack branch-log-panel ${controlClass}`} ref={panelRef}>
      <div className="role-row">
        <h2 className="panel-title">
          <MessageCircle size={18} /> Regional chat
        </h2>
        <span className="badge">{timeline.length}</span>
      </div>
      <div className="timeline" ref={timelineRef}>
        {feed.map((entry) => {
          if (entry.kind === "marv") {
            return renderMarvMessage(entry);
          }
          if (entry.kind === "guess") {
            const hasMask = Boolean(entry.mask?.length);
            return renderPlayerMessage({
              extraClass: ["guess-bubble", hasMask ? "guess-mask-bubble" : ""].filter(Boolean).join(" "),
              id: entry.id,
              playerId: entry.playerId,
              playerName: entry.playerName,
              reaction: entry.label === "correct" ? "🏆" : "🚫",
              children: hasMask ? (
                <GuessMask mask={entry.mask ?? []} />
              ) : (
                entry.text ?? (entry.label === "correct" ? "guessed correctly" : "made a wrong guess")
              )
            });
          }
          if (entry.kind === "emoji") {
            return renderPlayerMessage({
              id: entry.id,
              playerId: entry.playerId,
              playerName: entry.playerName,
              extraClass: "emoji-bubble",
              children: (
                <span aria-label={emojiLabel(entry.emojiId)} className="emoji-glyph" role="img">
                  {emojiGlyph(entry.emojiId)}
                </span>
              )
            });
          }
          return renderPlayerMessage({
            id: entry.id,
            playerId: entry.playerId,
            playerName: entry.playerName,
            extraClass: entry.encrypted ? "encrypted" : "",
            children: entry.text
          });
        })}
      </div>
      {canEmoji ? (
        <div className={`emoji-row emoji-picker-row ${emojiPickerOpen ? "open" : ""}`} aria-hidden={!emojiPickerOpen}>
          {EMOJIS.map(({ id, label }, index) => (
            <button
              aria-label={`${label}, shortcut ${index + 1}`}
              className="tiny-button emoji-button keytip-button"
              data-shortcut={index + 1}
              disabled={!emojiPickerOpen}
              key={id}
              onClick={() => {
                sendEmoji(id);
              }}
              type="button"
            >
              {emojiGlyph(id)}
            </button>
          ))}
        </div>
      ) : null}
      {canChat ? (
        <form className="input-row chat-input-row" onSubmit={submit}>
          <input
            className="text-input"
            onBlur={() => setChatInputFocused(false)}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setChatInputFocused(true)}
            placeholder={chatInputFocused ? "" : canGuess ? "Type your guess" : "Talk to your branch"}
            ref={chatInputRef}
            value={text}
          />
          <button aria-label="Send message, Enter" className="secondary-button keytip-button" data-shortcut="↵" type="submit">
            <Send size={16} />
          </button>
          {renderEmojiToggle()}
        </form>
      ) : showBoundaryControl && boundaryPrompt ? (
        <div className="role-action-row boundary-action-row">
          <BoundaryAction onPick={boundaryPick} prompt={boundaryPrompt} />
          {renderEmojiToggle("role-emoji-toggle")}
        </div>
      ) : showShipControl ? (
        <div className="role-action-row ship-action-row">
          <button className="ship-button chat-ship-button" disabled={!canShip} onClick={ship} type="button">
            <Send size={22} />
            Ship this mail!
          </button>
          {renderEmojiToggle("role-emoji-toggle")}
        </div>
      ) : showEmojiOnlyControl ? (
        <div className="emoji-only-row">{renderEmojiToggle("role-emoji-toggle")}</div>
      ) : null}
      {snapshot ? <RoleBadge role={snapshot.role} /> : null}
    </div>
  );
}
