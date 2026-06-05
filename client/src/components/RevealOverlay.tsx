"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Lock, Trophy } from "lucide-react";
import { MAIL_TYPE_RATIO } from "@special-delivery/shared";
import type { ShipRevealPayload, Stroke } from "@special-delivery/shared";
import { useGameStore } from "../store";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

export function RevealOverlay({ reveal }: { reveal: ShipRevealPayload }) {
  const mailType = useGameStore((state) => state.snapshot?.mailType);
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - reveal.revealStartAt));
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.max(0, Date.now() - reveal.revealStartAt)), 120);
    return () => clearInterval(interval);
  }, [reveal.revealStartAt]);

  useEffect(() => {
    const scoreTimer = window.setTimeout(() => playCue("score-pop"), 1_800);
    const winTimer =
      reveal.roundWinner === "TIE" ? undefined : window.setTimeout(() => playCue("round-win"), 3_000);
    return () => {
      window.clearTimeout(scoreTimer);
      if (winTimer) window.clearTimeout(winTimer);
    };
  }, [reveal.revealStartAt, reveal.roundWinner]);

  const beat = elapsed < 800 ? "Freeze" : elapsed < 1_800 ? "Force-lock" : elapsed < 3_000 ? "Stamp" : "Compare";
  const reasonLabel = getRevealReasonLabel(reveal);
  const ratio = MAIL_TYPE_RATIO[mailType ?? "POSTCARD"];

  useGsapAnimation(overlayRef, [reveal.revealStartAt], (gsap) => {
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .fromTo(".reveal-overlay", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 })
      .from(".reveal-heading", { autoAlpha: 0, y: 18, duration: 0.28 }, 0.05)
      .from(".reveal-force-lock", { autoAlpha: 0, x: -18, duration: 0.26 }, 0.16)
      .from(".reveal-side", { autoAlpha: 0, y: 28, scale: 0.97, duration: 0.38, stagger: 0.09 }, 0.22)
      .from(".reveal-result", { autoAlpha: 0, scale: 0.92, duration: 0.36, ease: "back.out(1.7)" }, 0.44);
  });

  useGsapAnimation(overlayRef, [beat], (gsap) => {
    gsap.fromTo(".reveal-title", { scale: 0.94, y: 5 }, { scale: 1, y: 0, duration: 0.24, ease: "back.out(2)" });
  });

  return (
    <div className="reveal-overlay" ref={overlayRef}>
      <div className="reveal-board">
        <div className="reveal-heading">
          <h2 className="reveal-title">{beat}</h2>
          <span className="reveal-reason">{reasonLabel}</span>
        </div>
        {reveal.forceLockedBranch ? (
          <div className="panel reveal-force-lock">
            <Lock size={18} /> Branch {reveal.forceLockedBranch} was force-locked.
            {reveal.forceLockCutOff[reveal.forceLockedBranch]
              ? ` Force-lock cut off ${reveal.forceLockCutOff[reveal.forceLockedBranch]} active guessers.`
              : null}
          </div>
        ) : null}
        <div className="reveal-sides">
          {reveal.sides.map((side) => (
            <div className="reveal-side" key={side.branchId}>
              <span className="badge">{side.branchName}</span>
              <DrawingSnapshot ratio={ratio} strokes={side.strokes} />
              <div className="reveal-side-details">
                <p className="reveal-word-line">
                  <strong>{side.word}</strong> was the word
                </p>
                <p>{side.correctCount} correct {side.correctCount === 1 ? "guess" : "guesses"}</p>
                <p className="reveal-points-line">
                  <strong>{side.stampValue}</strong> {side.stampValue === 1 ? "point" : "points"} earned{" "}
                  <span className="badge red">{formatPostageClass(side.postageClass)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="panel reveal-result">
          <Trophy size={18} />{" "}
          {reveal.roundWinner === "TIE" ? "Round tied" : `Branch ${reveal.roundWinner} won the round`}
          {reveal.isClosingRound ? " · Closing Time doubled the stamps" : ""}
        </div>
      </div>
    </div>
  );
}

function DrawingSnapshot({
  ratio,
  strokes
}: {
  ratio: { width: number; height: number };
  strokes: Stroke[];
}) {
  const maxWidth = ratio.height > ratio.width ? "220px" : ratio.width === ratio.height ? "340px" : "460px";
  const paperStyle = {
    "--reveal-paper-max-width": maxWidth,
    "--reveal-paper-ratio": ratio.width / ratio.height,
    aspectRatio: `${ratio.width} / ${ratio.height}`
  } as CSSProperties;

  return (
    <div className="reveal-drawing-preview">
      <div className="reveal-drawing-paper" style={paperStyle}>
        <svg className="reveal-drawing-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          {strokes
            .filter((stroke) => stroke.op === "fill")
            .map((stroke) =>
              stroke.image ? (
                <image href={stroke.image} height="1000" key={stroke.id} preserveAspectRatio="none" width="1000" x="0" y="0" />
              ) : (
                <rect fill={stroke.color} height="1000" key={stroke.id} width="1000" x="0" y="0" />
              )
            )}
          {strokes
            .filter((stroke) => stroke.op !== "fill")
            .map((stroke) => (
              <polyline
                key={stroke.id}
                fill="none"
                points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
                stroke={stroke.op === "erase" ? "#ffffff" : stroke.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={stroke.width * 2.5}
              />
            ))}
        </svg>
      </div>
    </div>
  );
}

function getRevealReasonLabel(reveal: ShipRevealPayload) {
  if (reveal.reason === "sweep") return reveal.shippedBy ? `Branch ${reveal.shippedBy} auto-shipped` : "Auto-shipped";
  if (reveal.reason === "manual") return reveal.shippedBy ? `Branch ${reveal.shippedBy} shipped` : "Shipped";
  return "Timer expired";
}

function formatPostageClass(postageClass: string) {
  return postageClass
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
