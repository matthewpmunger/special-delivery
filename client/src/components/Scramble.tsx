"use client";

import { useRef, useState, type CSSProperties } from "react";
import { MAIL_TYPE_LABEL, MAIL_TYPE_RATIO, type MailType } from "@special-delivery/shared";
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
      <div className="scramble-grid scramble-bin-grid">
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
      <div className="scramble-grid scramble-piece-grid">
        {visiblePieces.map((piece) => (
          <div
            className={`scramble-piece${dragging === piece.id ? " dragging" : ""}`}
            draggable={canSort}
            key={piece.id}
            style={mailCueStyle(piece.type)}
            title={`${MAIL_TYPE_LABEL[piece.type]} mail piece`}
            aria-label={`${MAIL_TYPE_LABEL[piece.type]} mail piece. Match by shape, color, or pattern.`}
            onDragEnd={() => setDragging(undefined)}
            onDragStart={() => {
              if (canSort) setDragging(piece.id);
            }}
          >
            <MailShapeCue mailType={piece.type} size="piece" />
            <span>{MAIL_TYPE_LABEL[piece.type]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MAIL_CUES: Record<
  MailType,
  { color: string; colorName: string; pattern: "bars" | "dots" | "checker" | "diagonal" | "crosshatch" | "vertical" }
> = {
  POSTCARD: { color: "#235f84", colorName: "blue", pattern: "bars" },
  GREETING_CARD: { color: "#8b4aa5", colorName: "purple", pattern: "dots" },
  PACKAGE: { color: "#c2473c", colorName: "red", pattern: "checker" },
  TAKEOUT_MENU: { color: "#d7831f", colorName: "orange", pattern: "diagonal" },
  MAGAZINE: { color: "#437f5b", colorName: "green", pattern: "crosshatch" },
  NEWSPAPER: { color: "#69737a", colorName: "gray", pattern: "vertical" }
};

function mailCueStyle(mailType: MailType): CSSProperties {
  const ratio = MAIL_TYPE_RATIO[mailType];
  const cue = MAIL_CUES[mailType];
  return {
    "--scramble-cue-color": cue.color,
    "--scramble-shape-ratio": `${ratio.width} / ${ratio.height}`
  } as CSSProperties;
}

function MailShapeCue({ mailType, size }: { mailType: MailType; size: "bin" | "piece" }) {
  const cue = MAIL_CUES[mailType];
  return (
    <span
      aria-hidden="true"
      className={`scramble-shape-cue scramble-shape-${size} scramble-pattern-${cue.pattern}`}
      style={mailShapeCueStyle(mailType, size)}
    />
  );
}

function mailShapeCueStyle(mailType: MailType, size: "bin" | "piece"): CSSProperties {
  const ratio = MAIL_TYPE_RATIO[mailType];
  const maxWidth = size === "bin" ? 92 : 108;
  const maxHeight = size === "bin" ? 48 : 54;
  const scale = Math.min(maxWidth / ratio.width, maxHeight / ratio.height);
  return {
    ...mailCueStyle(mailType),
    height: `${Math.round(ratio.height * scale)}px`,
    width: `${Math.round(ratio.width * scale)}px`
  };
}

function ScrambleBin({
  bin,
  canSort,
  dragging,
  onDrop,
  sortedPieces
}: {
  bin: { id: MailType; label: string };
  canSort: boolean;
  dragging?: string;
  onDrop: (pieceId: string) => void;
  sortedPieces: Array<{ id: string; branchId: string }>;
}) {
  const visibleChips = sortedPieces.slice(0, 6);
  const overflow = sortedPieces.length - visibleChips.length;
  const cue = MAIL_CUES[bin.id];
  return (
    <div
      className="scramble-bin"
      data-can-sort={canSort ? "true" : "false"}
      style={mailCueStyle(bin.id)}
      title={`${bin.label}: ${cue.colorName} ${cue.pattern} outline`}
      onDragOver={(event) => {
        if (canSort) event.preventDefault();
      }}
      onDrop={() => {
        if (!canSort || !dragging) return;
        onDrop(dragging);
      }}
    >
      <div className="scramble-bin-heading">
        <strong>{bin.label}</strong>
        <MailShapeCue mailType={bin.id} size="bin" />
      </div>
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
