"use client";

import { useRef, useState } from "react";
import type { MailType } from "@special-delivery/shared";
import { useGameStore } from "../store";
import { usePhaseActive } from "../usePhaseActive";
import { useGsapAnimation } from "../useGsapAnimation";

export function Scramble() {
  const snapshot = useGameStore((state) => state.snapshot);
  const scramble = useGameStore((state) => state.scramble);
  const scrambleSort = useGameStore((state) => state.scrambleSort);
  const [dragging, setDragging] = useState<string | undefined>();
  const scrambleRef = useRef<HTMLDivElement>(null);
  const canSort = usePhaseActive(snapshot);

  useGsapAnimation(scrambleRef, [scramble?.endsAt], (gsap) => {
    gsap.fromTo(
      ".scramble-bin, .scramble-piece",
      { autoAlpha: 0, y: 16, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.26, stagger: 0.025, ease: "back.out(1.2)" }
    );
  });

  useGsapAnimation(scrambleRef, [scramble?.scores.A, scramble?.scores.B], (gsap) => {
    gsap.fromTo(".role-row .badge", { scale: 1.16 }, { scale: 1, duration: 0.26, ease: "back.out(2)" });
  });

  if (!scramble) return null;

  const visiblePieces = scramble.pieces.filter((piece) => !piece.sortedBinId).slice(0, 24);
  const sortedByBin = scramble.pieces.reduce<Record<string, typeof scramble.pieces>>((groups, piece) => {
    if (!piece.sortedBinId) return groups;
    groups[piece.sortedBinId] = [...(groups[piece.sortedBinId] ?? []), piece];
    return groups;
  }, {});

  return (
    <div className="panel stack scramble-panel" ref={scrambleRef}>
      <div className="role-row">
        <h2 className="section-title">Midday Special Delivery</h2>
        <span className="badge">
          A {scramble.scores.A} · B {scramble.scores.B}
        </span>
      </div>
      <div className="scramble-grid">
        {scramble.bins.map((bin) => (
          <ScrambleBin
            bin={bin}
            canSort={canSort}
            dragging={dragging}
            key={bin.id}
            onDrop={(pieceId) => {
              scrambleSort(pieceId, bin.id as MailType);
              setDragging(undefined);
            }}
            sortedPieces={sortedByBin[bin.id] ?? []}
          />
        ))}
      </div>
      <div className="scramble-grid">
        {visiblePieces.map((piece) => (
          <div
            className={`scramble-piece${dragging === piece.id ? " dragging" : ""}`}
            draggable={canSort}
            key={piece.id}
            onDragEnd={() => setDragging(undefined)}
            onDragStart={() => {
              if (canSort) setDragging(piece.id);
            }}
          >
            {piece.type.replace("_", " ")}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScrambleBin({
  bin,
  canSort,
  dragging,
  onDrop,
  sortedPieces
}: {
  bin: { id: string; label: string };
  canSort: boolean;
  dragging?: string;
  onDrop: (pieceId: string) => void;
  sortedPieces: Array<{ id: string; branchId: string }>;
}) {
  const visibleChips = sortedPieces.slice(0, 6);
  const overflow = sortedPieces.length - visibleChips.length;
  return (
    <div
      className="scramble-bin"
      data-can-sort={canSort ? "true" : "false"}
      onDragOver={(event) => {
        if (canSort) event.preventDefault();
      }}
      onDrop={() => {
        if (!canSort || !dragging) return;
        onDrop(dragging);
      }}
    >
      <strong>{bin.label}</strong>
      {sortedPieces.length > 0 ? (
        <div className="scramble-bin-resolved" aria-label={`${sortedPieces.length} sorted into ${bin.label}`}>
          <span>{sortedPieces.length} sorted</span>
          <div className="scramble-bin-chips">
            {visibleChips.map((piece) => (
              <span className="scramble-bin-chip" key={piece.id}>
                {piece.branchId}
              </span>
            ))}
            {overflow > 0 ? <span className="scramble-bin-chip">+{overflow}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
