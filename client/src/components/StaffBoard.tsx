"use client";

import { Award } from "lucide-react";
import { useRef } from "react";
import { useGameStore } from "../store";
import { useGsapAnimation } from "../useGsapAnimation";

export function StaffBoard() {
  const matchEnd = useGameStore((state) => state.matchEnd);
  const boardRef = useRef<HTMLDivElement>(null);

  useGsapAnimation(boardRef, [matchEnd?.winner, matchEnd?.finalScores.A, matchEnd?.finalScores.B], (gsap) => {
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .from(".staff-board > .role-row", { autoAlpha: 0, y: 12, duration: 0.22 })
      .from(".staff-metric", { autoAlpha: 0, y: 18, scale: 0.98, duration: 0.3, ease: "back.out(1.5)" }, 0.08)
      .from(".staff-score-cell", { autoAlpha: 0, y: 12, duration: 0.25, stagger: 0.08 }, 0.18)
      .from(".staff-award-card", { autoAlpha: 0, x: -14, duration: 0.28, stagger: 0.08 }, 0.28);
  });

  if (!matchEnd) return null;
  return (
    <div className="panel staff-board" ref={boardRef}>
      <div className="role-row">
        <h2 className="panel-title">Staff Board</h2>
        <Award size={18} />
      </div>
      <div className="staff-metric">
        <span>Winner</span>
        <strong>{matchEnd.winner === "TIE" ? "Tie" : `Branch ${matchEnd.winner}`}</strong>
      </div>
      <div className="staff-score-summary" aria-label="Final score">
        <span className="staff-score-heading">Final score</span>
        <div className="staff-score-grid">
          <div className="staff-score-cell">
            <span>Branch A</span>
            <strong>{matchEnd.finalScores.A}</strong>
            <small>{matchEnd.roundsWon.A} rounds won</small>
          </div>
          <div className="staff-score-cell">
            <span>Branch B</span>
            <strong>{matchEnd.finalScores.B}</strong>
            <small>{matchEnd.roundsWon.B} rounds won</small>
          </div>
        </div>
      </div>
      {matchEnd.awards.map((award) => (
        <div className="staff-award-card" key={award.playerId}>
          <strong className="staff-award-name">{award.playerName}</strong>
          <span className="staff-award-label">{award.title}</span>
          <p className="staff-award-detail">{award.detail}</p>
        </div>
      ))}
    </div>
  );
}
