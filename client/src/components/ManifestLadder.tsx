"use client";

import { ArrowDown, ArrowUp, Check, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store";
import { usePhaseActive } from "../usePhaseActive";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

type MoveFeedback = {
  direction: -1 | 1;
  id: string;
  nonce: number;
};

export function ManifestLadder() {
  const snapshot = useGameStore((state) => state.snapshot);
  const candidates = snapshot?.manifestCandidates;
  const rankManifest = useGameStore((state) => state.rankManifest);
  const [order, setOrder] = useState<string[]>(() => candidates?.map((candidate) => candidate.id) ?? []);
  const [locked, setLocked] = useState(false);
  const [moveFeedback, setMoveFeedback] = useState<MoveFeedback | null>(null);
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

  useGsapAnimation(panelRef, [moveFeedback?.nonce], (gsap, root) => {
    if (!moveFeedback) return;
    const movedCard = [...root.querySelectorAll<HTMLElement>(".manifest-option")].find(
      (option) => option.dataset.candidateId === moveFeedback.id
    );
    if (!movedCard) return;
    const fromY = moveFeedback.direction === -1 ? 22 : -22;
    gsap.fromTo(
      movedCard,
      { boxShadow: "0 0 0 0 rgba(230, 170, 63, 0.55)", scale: 0.985, y: fromY },
      {
        boxShadow: "0 0 0 10px rgba(230, 170, 63, 0)",
        clearProps: "boxShadow,scale,y",
        duration: 0.32,
        ease: "back.out(1.7)",
        scale: 1,
        y: 0
      }
    );
    gsap.fromTo(
      movedCard,
      { backgroundColor: "rgba(230, 170, 63, 0.28)" },
      { backgroundColor: "#fffaf0", clearProps: "backgroundColor", duration: 0.48, ease: "power2.out" }
    );
  });

  if (!candidates?.length) return null;

  function move(index: number, delta: -1 | 1) {
    const next = index + delta;
    const item = order[index];
    const swapItem = order[next];
    if (locked || !canRank || next < 0 || next >= order.length || !item || !swapItem) return;
    playCue("ui-click");
    setMoveFeedback({ direction: delta, id: item, nonce: Date.now() });
    setOrder((current) => {
      const copy = [...current];
      copy[index] = swapItem;
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
          <div className={`manifest-option ${locked ? "locked" : ""}`} data-candidate-id={candidate.id} key={candidate.id}>
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
