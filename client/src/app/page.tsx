"use client";

import { useEffect, useRef, useState } from "react";
import { CircleX, PackageOpen, Play, RadioTower, Sparkles } from "lucide-react";
import { useGameStore } from "../store";
import { MatchView } from "../components/MatchView";
import { phaseIsBriefing, phaseLabel } from "../phase";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

export default function Home() {
  const initialize = useGameStore((state) => state.initialize);
  const connected = useGameStore((state) => state.connected);
  const snapshot = useGameStore((state) => state.snapshot);
  const lastError = useGameStore((state) => state.lastError);
  const leaveToMainMenu = useGameStore((state) => state.leaveToMainMenu);
  const join = useGameStore((state) => state.join);
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") ?? "";
    if (room) setCode(room.toUpperCase());
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", snapshot.code);
    window.history.replaceState({}, "", url);
  }, [snapshot?.code]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <button
            aria-label="Return to main menu"
            className="brand-mark"
            onClick={() => {
              playCue("ui-click");
              setCode("");
              leaveToMainMenu();
            }}
            title="Return to main menu"
            type="button"
          >
            SD
          </button>
          <div>
            <h1>Special Delivery</h1>
            <p>{snapshot ? snapshot.ownBranch.name : "Rival branches, blank mail, one very nervous robot"}</p>
          </div>
        </div>
        <MatchScoreboard />
        <div className="status-pill">
          <span className={`dot ${connected ? "connected" : "disconnected"}`} />
          <RadioTower size={16} />
          {connected ? "Server connected" : "Server offline"}
        </div>
      </header>

      {snapshot ? (
        <MatchView />
      ) : (
        <JoinScreen code={code} join={join} nickname={nickname} setCode={setCode} setNickname={setNickname} />
      )}

      {lastError ? <div className="error-toast">{lastError}</div> : null}
    </main>
  );
}

function JoinScreen({
  code,
  join,
  nickname,
  setCode,
  setNickname
}: {
  code: string;
  join: (code: string | undefined, nickname: string, create?: boolean) => void;
  nickname: string;
  setCode: (code: string) => void;
  setNickname: (nickname: string) => void;
}) {
  const hasInviteCode = code.trim().length > 0;
  const [joinExpanded, setJoinExpanded] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="join-screen">
      <form
        className="join-panel join-panel-wide"
        onSubmit={(event) => {
          event.preventDefault();
          if (!nickname.trim()) return;
          playCue(hasInviteCode ? "ui-click" : "room-created");
          if (hasInviteCode) join(code, nickname);
          else join(undefined, nickname, true);
        }}
      >
        <PackageOpen size={34} />
        <div className="stack">
          <h2>Join the sorting floor</h2>
          <p className="muted-copy">
            Create a room for your branch, or paste a room code from someone else's invite.
          </p>
        </div>
        <label>
          Nickname
          <input
            autoComplete="name"
            className="text-input"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Your name"
          />
        </label>
        <div className={`join-actions-grid ${joinExpanded ? "join-expanded" : ""}`}>
          <button
            className="primary-button join-action-button"
            disabled={!nickname.trim()}
            onClick={() => {
              playCue("room-created");
              join(undefined, nickname, true);
            }}
            type="button"
          >
            <Sparkles size={20} />
            Create room
          </button>
          <div className="join-action-slot">
            {joinExpanded ? (
              <div className="join-code-inline">
                <div className="join-code-input-wrap">
                  <input
                    aria-label="Room code"
                    className="text-input join-code-input"
                    placeholder="ABC12345"
                    ref={codeInputRef}
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                  />
                  {hasInviteCode ? (
                    <button
                      aria-label="Clear room code"
                      className="join-code-clear"
                      onClick={() => {
                        playCue("ui-click");
                        setCode("");
                        codeInputRef.current?.focus();
                      }}
                      type="button"
                    >
                      <CircleX size={18} />
                    </button>
                  ) : null}
                </div>
                <button
                  aria-label="Join room"
                  className="primary-button join-submit-button"
                  disabled={!nickname.trim() || !hasInviteCode}
                  type="submit"
                >
                  <Play size={18} />
                </button>
              </div>
            ) : (
              <button
                className="secondary-button join-action-button"
                onClick={() => {
                  playCue("ui-click");
                  setJoinExpanded(true);
                }}
                type="button"
              >
                <Play size={20} />
                Join room
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

function MatchScoreboard() {
  const snapshot = useGameStore((state) => state.snapshot);
  const [now, setNow] = useState(() => Date.now());
  const lastTickSecond = useRef<number | undefined>(undefined);
  const expiredKey = useRef<string | undefined>(undefined);
  const scoreboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const briefing = snapshot ? phaseIsBriefing(snapshot, now) : false;
  const remainingMs = snapshot ? Math.max(0, (briefing ? snapshot.phaseStartedAt : snapshot.phaseEndsAt) - now) : 0;
  const timerActive = Boolean(snapshot && snapshot.phase !== "LOBBY" && snapshot.phase !== "MATCH_END" && remainingMs > 0);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const phase = snapshot ? phaseLabel(snapshot.phase) : "";
  const timerKey = snapshot ? `${snapshot.matchId}:${snapshot.phase}:${snapshot.roundIndex}:${snapshot.phaseEndsAt}` : "";

  useEffect(() => {
    if (!snapshot || briefing || snapshot.phase === "LOBBY" || snapshot.phase === "MATCH_END") return;
    if (timerActive && totalSeconds > 0 && totalSeconds <= 5 && lastTickSecond.current !== totalSeconds) {
      lastTickSecond.current = totalSeconds;
      playCue("timer-tick");
    }
    if (remainingMs <= 0 && expiredKey.current !== timerKey) {
      expiredKey.current = timerKey;
      playCue("timer-expired");
    }
  }, [briefing, remainingMs, snapshot?.phase, timerActive, timerKey, totalSeconds]);

  useEffect(() => {
    lastTickSecond.current = undefined;
    expiredKey.current = undefined;
  }, [timerKey]);

  useGsapAnimation(scoreboardRef, [snapshot?.phase, snapshot?.roundIndex], (gsap) => {
    gsap.fromTo(
      ".scoreboard-clock",
      { y: -8, scale: 0.98 },
      { y: 0, scale: 1, duration: 0.3, ease: "back.out(1.6)" }
    );
  });

  useGsapAnimation(scoreboardRef, [snapshot?.ownBranch.score, snapshot?.opponent.score], (gsap) => {
    gsap.fromTo(
      ".scoreboard-team strong",
      { scale: 1.28, color: "#e6aa3f" },
      { scale: 1, color: "#fffaf0", duration: 0.34, ease: "back.out(2)" }
    );
  });

  useGsapAnimation(scoreboardRef, [totalSeconds, timerKey], (gsap) => {
    if (briefing || totalSeconds <= 0 || totalSeconds > 5) return;
    gsap.fromTo(
      ".scoreboard-clock",
      { scale: 1.05 },
      { scale: 1, duration: 0.24, ease: "power3.out" }
    );
  });

  if (!snapshot) return null;

  return (
    <div className={`match-scoreboard ${timerActive ? "" : "idle"} ${briefing ? "briefing" : ""}`} aria-live="polite" ref={scoreboardRef}>
      <div className="scoreboard-team own">
        <span>{snapshot.ownBranch.name}</span>
        <strong>{snapshot.ownBranch.score}</strong>
      </div>
      <div className="scoreboard-clock">
        <span>Round {snapshot.roundIndex + 1}</span>
        <small>{phase}</small>
        <strong>{timerActive ? `${minutes}:${seconds}` : "--:--"}</strong>
      </div>
      <div className="scoreboard-team opponent">
        <strong>{snapshot.opponent.score}</strong>
        <span>{snapshot.opponent.name}</span>
      </div>
    </div>
  );
}
