"use client";

import { Copy, Gift, Link as LinkIcon, Play, Settings, Trophy, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { BranchId, ClientSnapshot } from "@special-delivery/shared";
import type { ScrambleResultPayload } from "@special-delivery/shared/events";
import { useGameStore } from "../store";
import { Canvas } from "./Canvas";
import { Chat } from "./Chat";
import { ManifestLadder } from "./ManifestLadder";
import { PhaseSplash } from "./PhaseSplash";
import { RevealOverlay } from "./RevealOverlay";
import { Scramble } from "./Scramble";
import { StaffBoard } from "./StaffBoard";
import { playCue } from "../audio";

export function MatchView() {
  const lobby = useGameStore((state) => state.lobby);
  const snapshot = useGameStore((state) => state.snapshot);
  const reveal = useGameStore((state) => state.reveal);
  const scramble = useGameStore((state) => state.scramble);
  const scrambleResult = useGameStore((state) => state.scrambleResult);
  const matchEnd = useGameStore((state) => state.matchEnd);
  const startMatch = useGameStore((state) => state.startMatch);

  if (!snapshot) return null;

  const ownPlayers = snapshot.ownBranch.players;

  return (
    <>
      <section className="match-grid">
        <section className="stack play-column">
          <div className="panel score-card score-card-canvas">
            <div className="match-meta-strip">
              <span className="match-meta-chip strong">{snapshot.role}</span>
              <span className="match-meta-chip">{snapshot.postageClass.replace("_", " ")}</span>
              <span className="match-meta-chip">{snapshot.classTierLabel}</span>
              <span className="match-meta-chip">{snapshot.mailType.replace("_", " ")}</span>
            </div>
          </div>
          <div className="play-surface-slot">
            {scramble ? <Scramble /> : <Canvas />}
            {snapshot.phase === "LOBBY" && !scramble ? (
              <div className="surface-panel-overlay">
                <LobbyPanel
                  code={lobby?.code ?? snapshot.code}
                  playerCount={lobby?.players.length ?? ownPlayers.length}
                  startMatch={startMatch}
                />
              </div>
            ) : null}
            {snapshot.phase === "MANIFEST" ? (
              <div className="surface-panel-overlay">
                <ManifestLadder />
              </div>
            ) : null}
            {scrambleResult ? (
              <div className="surface-panel-overlay">
                <ScrambleResultPanel result={scrambleResult} snapshot={snapshot} />
              </div>
            ) : null}
            <PhaseSplash snapshot={snapshot} />
            {reveal && snapshot.phase !== "MATCH_END" ? <RevealOverlay reveal={reveal} /> : null}
            {matchEnd ? (
              <div className="match-end-overlay">
                <StaffBoard />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="stack log-column">
          <Chat />
        </aside>
      </section>
    </>
  );
}

function ScrambleResultPanel({
  result,
  snapshot
}: {
  result: ScrambleResultPayload;
  snapshot: ClientSnapshot;
}) {
  const branchName = (branchId: BranchId) =>
    branchId === snapshot.ownBranch.id ? snapshot.ownBranch.name : snapshot.opponent.name;
  const winnerName = result.winner === "TIE" || !result.winner ? undefined : branchName(result.winner);
  const sortedScores = (["A", "B"] as const).map((branchId) => ({
    branchId,
    name: branchName(branchId),
    score: result.scores[branchId]
  }));

  return (
    <div className="panel stack surface-result-panel scramble-result-panel">
      <div className="scramble-result-heading">
        <span aria-hidden="true" className="scramble-result-icon">
          <Trophy size={24} />
        </span>
        <div>
          <span>Scramble result</span>
          <h2 className="section-title">{winnerName ? `${winnerName} won the truck spill` : "The truck spill tied"}</h2>
        </div>
      </div>
      <div className="scramble-result-scores">
        {sortedScores.map((branch) => (
          <div className="scramble-result-score" key={branch.branchId}>
            <span>{branch.name}</span>
            <strong>{branch.score}</strong>
            <small>{branch.score === 1 ? "sorting point" : "sorting points"}</small>
          </div>
        ))}
      </div>
      <div className="scramble-reward-row">
        <Gift size={18} />
        <div>
          <span>Reward</span>
          <strong>
            {winnerName
              ? `${winnerName} gets the scramble tiebreaker advantage.`
              : "No reward awarded on a tie."}
          </strong>
        </div>
      </div>
      <p className="scramble-result-note">Scramble points do not add to the match score.</p>
    </div>
  );
}

function LobbyPanel({
  code,
  playerCount,
  startMatch
}: {
  code: string;
  playerCount: number;
  startMatch: (options?: {
    cyclesTotal?: number;
    soloPlaytest?: boolean;
    soloScrambleTest?: boolean;
    soloRole?: "POSTMASTER" | "CREW" | "MAILMAN";
    drawGuessSeconds?: number;
  }) => void;
}) {
  const [cyclesTotal, setCyclesTotal] = useState(1);
  const [drawGuessSeconds, setDrawGuessSeconds] = useState(45);
  const [copyStatus, setCopyStatus] = useState<"idle" | "link" | "code" | "blocked">("idle");
  const [showPlaytestControls, setShowPlaytestControls] = useState(false);
  const shareLink = useMemo(() => {
    if (typeof window === "undefined") return code;
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    return url.toString();
  }, [code]);

  async function copyText(text: string, kind: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
      playCue("ui-copy");
      setCopyStatus(kind);
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      playCue("error");
      setCopyStatus("blocked");
    }
  }

  const startOptions = { cyclesTotal, drawGuessSeconds };
  const soloStartOptions = { ...startOptions, cyclesTotal: Math.max(2, cyclesTotal), soloPlaytest: true };

  return (
    <div className="panel stack lobby-panel">
      <div className="role-row">
        <h2 className="panel-title">Lobby</h2>
      </div>
      <div className="meta-row">
        <span>
          <Users size={16} /> Players
        </span>
        <strong>{playerCount}</strong>
      </div>
      <div className="share-room-panel">
        <div className="role-row">
          <strong>
            <LinkIcon size={16} /> Invite link
          </strong>
          <span className="share-status">
            {copyStatus === "link"
              ? "Link copied"
              : copyStatus === "code"
                ? "Code copied"
                : copyStatus === "blocked"
                  ? "Copy blocked; select the link manually"
                  : "Share this with your crew"}
          </span>
        </div>
        <input className="text-input share-link-input" readOnly value={shareLink} />
        <div className="share-room-actions">
          <button className="secondary-button" onClick={() => copyText(shareLink, "link")} type="button">
            <Copy size={16} />
            Copy link
          </button>
          <button className="secondary-button" onClick={() => copyText(code, "code")} type="button">
            <Copy size={16} />
            Copy code
          </button>
        </div>
      </div>
      <div className="lobby-settings">
        <div className="role-row">
          <strong>
            <Settings size={16} /> Game settings
          </strong>
          <button
            aria-expanded={showPlaytestControls}
            aria-label={showPlaytestControls ? "Hide playtest controls" : "Show playtest controls"}
            className={`icon-button playtest-toggle-button${showPlaytestControls ? " active" : ""}`}
            onClick={() => {
              playCue("ui-click");
              setShowPlaytestControls((visible) => !visible);
            }}
            title={showPlaytestControls ? "Hide playtest controls" : "Show playtest controls"}
            type="button"
          >
            <Settings size={16} />
          </button>
        </div>
        <label>
          Match length
          <select className="text-input" value={cyclesTotal} onChange={(event) => setCyclesTotal(Number(event.target.value))}>
            <option value={1}>Quick match</option>
            <option value={2}>Two-cycle match</option>
          </select>
        </label>
        <label>
          Timer length
          <select className="text-input" value={drawGuessSeconds} onChange={(event) => setDrawGuessSeconds(Number(event.target.value))}>
            <option value={30}>30 seconds</option>
            <option value={45}>45 seconds</option>
            <option value={60}>60 seconds</option>
            <option value={90}>90 seconds</option>
            <option value={120}>120 seconds</option>
          </select>
        </label>
        {showPlaytestControls ? (
          <div className="playtest-controls">
            <div className="role-row">
              <strong>Playtest controls</strong>
            </div>
            <button className="secondary-button" onClick={() => startMatch(soloStartOptions)}>
              <Play size={18} />
              Solo test
            </button>
            <div className="solo-fixture-actions" aria-label="Solo role starts">
              <button className="secondary-button" onClick={() => startMatch({ ...soloStartOptions, soloRole: "POSTMASTER" })}>
                Postmaster
              </button>
              <button className="secondary-button" onClick={() => startMatch({ ...soloStartOptions, soloRole: "CREW" })}>
                Crew
              </button>
              <button className="secondary-button" onClick={() => startMatch({ ...soloStartOptions, soloRole: "MAILMAN" })}>
                Mailman
              </button>
              <button
                className="secondary-button solo-scramble-button"
                onClick={() => startMatch({ ...soloStartOptions, soloScrambleTest: true })}
              >
                Solo scramble
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="lobby-actions">
        <button className="primary-button" onClick={() => startMatch(startOptions)}>
          <Play size={18} />
          Start match
        </button>
      </div>
    </div>
  );
}
