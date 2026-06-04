"use client";

import { ArrowDown, ArrowUp, Check, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store";
import { usePhaseActive } from "../usePhaseActive";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

export function ManifestLadder() {
  const snapshot = useGameStore((state) => state.snapshot);
  const candidates = snapshot?.manifestCandidates;
  const rankManifest = useGameStore((state) => state.rankManifest);
  const [order, setOrder] = useState<string[]>(() => candidates?.map((candidate) => candidate.id) ?? []);
  const [locked, setLocked] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const candidateKey = candidates?.map((candidate) => candidate.id).join(":") ?? "";
  const canRank = usePhaseActive(snapshot);

  useEffect(() => {
    setOrder(candidates?.map((candidate) => candidate.id) ?? []);
    setLocked(false);
  }, [candidateKey, candidates]);

  const orderedCandidates = useMemo(
    () =>
      order
        .map((id) => candidates?.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    [candidates, order]
  );

  useGsapAnimation(panelRef, [candidateKey], (gsap) => {
    gsap.fromTo(
      ".manifest-option",
      { autoAlpha: 0, y: 14, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, stagger: 0.06, ease: "back.out(1.3)" }
    );
  });

  useGsapAnimation(panelRef, [locked], (gsap) => {
    if (!locked) return;
    gsap.fromTo(
      ".locked-button",
      { scale: 0.96 },
      { scale: 1, duration: 0.34, ease: "elastic.out(1, 0.55)" }
    );
    gsap.to(".manifest-option", { y: 0, duration: 0.22, stagger: 0.04, ease: "power2.out" });
  });

  if (!candidates?.length) return null;

  function move(index: number, delta: -1 | 1) {
    setOrder((current) => {
      const copy = [...current];
      const next = index + delta;
      if (next < 0 || next >= copy.length) return copy;
      const item = copy[index];
      if (!item) return copy;
      copy[index] = copy[next] as string;
      copy[next] = item;
      return copy;
    });
  }

  return (
    <div className={`panel stack manifest-panel ${locked ? "locked" : ""}`} ref={panelRef}>
      <div className="role-row">
        <h2 className="panel-title">Manifest</h2>
        {locked ? <span className="badge manifest-locked"><CheckCircle2 size={14} /> Locked</span> : null}
      </div>
      <div className="manifest-list">
        {orderedCandidates.map((candidate, index) => (
          <div className={`manifest-option ${locked ? "locked" : ""}`} key={candidate.id}>
            <span>
              {index + 1}. {candidate.text}
            </span>
            <div className="manifest-actions">
              <button
                className="tiny-button"
                disabled={locked || !canRank || index === 0}
                onClick={() => move(index, -1)}
                title="Move up"
                type="button"
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="tiny-button"
                disabled={locked || !canRank || index === orderedCandidates.length - 1}
                onClick={() => move(index, 1)}
                title="Move down"
                type="button"
              >
                <ArrowDown size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        className={`primary-button ${locked ? "locked-button" : ""}`}
        disabled={locked || !canRank || order.length !== 3}
        onClick={() => {
          playCue("manifest-lock");
          setLocked(true);
          rankManifest(order as [string, string, string]);
        }}
        type="button"
      >
        {locked ? <CheckCircle2 size={18} /> : <Check size={18} />}
        {locked ? "Ranking locked" : "Lock ranking"}
      </button>
    </div>
  );
}
