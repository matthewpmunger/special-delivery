"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PaintBucket, RotateCcw, Trash2 } from "lucide-react";
import { MAIL_TYPE_RATIO } from "@special-delivery/shared";
import type { ClientSnapshot, Stroke } from "@special-delivery/shared";
import { useGameStore } from "../store";
import { usePhaseActive } from "../usePhaseActive";
import { playCue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

const COLORS = [
  { label: "Red", value: "#e53935" },
  { label: "Yellow", value: "#fdd835" },
  { label: "Blue", value: "#1e88e5" },
  { label: "Orange", value: "#fb8c00" },
  { label: "Green", value: "#43a047" },
  { label: "Purple", value: "#8e24aa" },
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#111111" },
  { label: "Gray", value: "#8a8f93" }
] as const;
const DEFAULT_COLOR = "#111111";
const FILL_RESOLUTION = 1024;
const FILL_JOIN_RADIUS = 4;
const FILL_BOUNDARY_WIDTH_RATIO = 0.42;
const BOUNDARY_ALPHA_THRESHOLD = 24;
const MAX_WIDTH_BY_TYPE = {
  POSTCARD: "820px",
  GREETING_CARD: "480px",
  PACKAGE: "620px",
  TAKEOUT_MENU: "420px",
  MAGAZINE: "520px",
  NEWSPAPER: "760px"
} as const;

export function Canvas() {
  const snapshot = useGameStore((state) => state.snapshot);
  const sendStroke = useGameStore((state) => state.sendStroke);
  const undo = useGameStore((state) => state.undo);
  const clear = useGameStore((state) => state.clear);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [width, setWidth] = useState(5);
  const [draft, setDraft] = useState<Stroke | undefined>();
  const [fillArmed, setFillArmed] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | undefined>(undefined);
  const draftRef = useRef<Stroke | undefined>(undefined);
  const draftScopeRef = useRef<string | undefined>(undefined);
  const activePhase = usePhaseActive(snapshot);
  const canvasScope = snapshot
    ? `${snapshot.matchId}:${snapshot.branchId}:${snapshot.roundIndex}:${snapshot.phaseStartedAt}:${snapshot.ownBranch.word ?? ""}`
    : "";

  const finishDraft = useCallback(
    (shouldSend: boolean) => {
      const current = draftRef.current;
      pointerId.current = undefined;
      draftRef.current = undefined;
      draftScopeRef.current = undefined;
      setDraft(undefined);
      if (shouldSend && current && current.points.length > 1) {
        sendStroke({ ...current, endedAt: Date.now() });
      }
    },
    [sendStroke]
  );

  useEffect(() => {
    if (!draftScopeRef.current || draftScopeRef.current === canvasScope) return;
    finishDraft(false);
  }, [canvasScope, finishDraft]);

  useEffect(() => {
    if (snapshot?.role === "POSTMASTER" && snapshot.phase === "DRAW_GUESS") return;
    finishDraft(snapshot?.phase === "SHIP_REVEAL" || snapshot?.phase === "REVEAL_HOLD");
    setFillArmed(false);
  }, [finishDraft, snapshot?.phase, snapshot?.role, snapshot?.roundIndex, snapshot?.matchId]);

  useEffect(() => {
    if (!snapshot || !draft || snapshot.role !== "POSTMASTER" || snapshot.phase !== "DRAW_GUESS" || !activePhase) return;
    const delay = Math.max(0, snapshot.phaseEndsAt - Date.now());
    const timer = window.setTimeout(() => finishDraft(true), delay);
    return () => window.clearTimeout(timer);
  }, [activePhase, draft?.id, finishDraft, snapshot?.phase, snapshot?.phaseEndsAt, snapshot?.role]);

  useEffect(() => {
    if (snapshot?.role === "POSTMASTER" && snapshot.phase === "DRAW_GUESS" && !activePhase) {
      finishDraft(true);
      setFillArmed(false);
    }
  }, [activePhase, finishDraft, snapshot?.phase, snapshot?.role]);

  useGsapAnimation(toolbarRef, [canvasScope], (gsap) => {
    gsap.fromTo(
      ".canvas-toolbar .tool-strip > *",
      { autoAlpha: 0, y: 12 },
      { autoAlpha: 1, y: 0, duration: 0.24, stagger: 0.035, ease: "power3.out" }
    );
  });

  useGsapAnimation(toolbarRef, [color], (gsap) => {
    gsap.fromTo(
      '.swatch-button[aria-pressed="true"]',
      { scale: 0.82 },
      { scale: 1, duration: 0.28, ease: "back.out(2.4)" }
    );
  });

  if (!snapshot) return null;
  const ratio = MAIL_TYPE_RATIO[snapshot.mailType];
  const canDraw = snapshot.role === "POSTMASTER" && snapshot.phase === "DRAW_GUESS" && activePhase;
  const strokes = dedupeStrokes([...(snapshot.ownBranch.roundStrokeLog ?? []), ...(draft ? [draft] : [])]);
  const word = snapshot.ownBranch.word;
  const wordHint = snapshot.ownBranch.wordHint;
  const wordDisplay = word ?? wordHint;
  const fillToolActive = canDraw && fillArmed;
  const canvasCursorState =
    canDraw
      ? "active"
      : snapshot.role === "POSTMASTER" && snapshot.phase === "DRAW_GUESS" && !activePhase
        ? "briefing"
        : snapshot.phase === "DRAW_GUESS"
          ? "viewing"
          : "locked";

  return (
    <div className="canvas-frame">
      <div className="mail-stage">
        <div
          className="mail-frame"
          data-cursor-state={canvasCursorState}
          data-mail-type={snapshot.mailType}
          data-tool={canDraw ? (fillToolActive ? "fill" : "draw") : undefined}
          style={{ aspectRatio: `${ratio.width} / ${ratio.height}`, maxWidth: MAX_WIDTH_BY_TYPE[snapshot.mailType] }}
          onPointerDown={(event) => {
            if (!canDraw) return;
            event.preventDefault();
            const point = toLogicalPoint(event.currentTarget, event.clientX, event.clientY);
            if (fillToolActive) {
              const fillStroke = createFloodFillStroke(snapshot.ownBranch.roundStrokeLog ?? [], point, color, width);
              playCue("fill-tool");
              if (fillStroke) sendStroke({ ...fillStroke, startedAt: Date.now(), endedAt: Date.now() });
              setFillArmed(false);
              return;
            }
            playCue("brush-stroke");
            const startedAt = Date.now();
            pointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            const nextDraft = {
              id: crypto.randomUUID(),
              points: [point],
              color,
              width,
              op: "draw",
              startedAt
            } satisfies Stroke;
            draftScopeRef.current = canvasScope;
            draftRef.current = nextDraft;
            setDraft(nextDraft);
          }}
          onPointerCancel={(event) => {
            if (pointerId.current === event.pointerId) {
              finishDraft(false);
            }
          }}
          onPointerMove={(event) => {
            if (!canDraw || pointerId.current !== event.pointerId) return;
            const point = toLogicalPoint(event.currentTarget, event.clientX, event.clientY);
            const current = draftRef.current;
            if (!current) return;
            const nextDraft = { ...current, points: [...current.points, point] };
            draftRef.current = nextDraft;
            setDraft(nextDraft);
          }}
          onPointerUp={(event) => {
            if (pointerId.current !== event.pointerId) return;
            finishDraft(canCommitDraft(snapshot, canDraw, draftRef.current));
          }}
        >
          <div className="mail-label">
            <span className="badge">{snapshot.mailType.replace("_", " ")}</span>
            <span className="badge red">{snapshot.postageClass.replace("_", " ")}</span>
          </div>
          <svg className="stroke-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
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
          {wordDisplay ? (
            <div className={`word-chip${word ? "" : " hint"}`}>
              {word ? wordDisplay : <WordHintSlots hint={wordDisplay} />}
            </div>
          ) : null}
        </div>
      </div>

      {canDraw ? (
        <div className="canvas-toolbar panel" ref={toolbarRef}>
          <div className="tool-strip">
            <div className="swatch-strip">
              {COLORS.map((swatch) => (
                <button
                  aria-label={`Use ${swatch.label}`}
                  aria-pressed={swatch.value === color}
                  className={`tiny-button swatch-button${swatch.value === "#ffffff" ? " light-swatch" : ""}`}
                  key={swatch.value}
                  onClick={() => setColor(swatch.value)}
                  style={{ background: swatch.value }}
                  type="button"
                />
              ))}
            </div>
            <label className="form-label brush-size">
              <Eraser size={16} />
              <input max={12} min={2} onChange={(event) => setWidth(Number(event.target.value))} type="range" value={width} />
            </label>
            <button
              aria-pressed={fillToolActive}
              className={`icon-button fill-tool-button${fillToolActive ? " active" : ""}`}
              onClick={() => setFillArmed((active) => !active)}
              title="Fill area"
              type="button"
            >
              <PaintBucket size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => {
                playCue("undo");
                undo();
              }}
              title="Undo"
              type="button"
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => {
                playCue("clear-canvas");
                clear();
              }}
              title="Clear"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function dedupeStrokes(strokes: Stroke[]): Stroke[] {
  const byId = new Map<string, Stroke>();
  for (const stroke of strokes) byId.set(stroke.id, stroke);
  return [...byId.values()];
}

function WordHintSlots({ hint }: { hint: string }) {
  return (
    <span aria-label={hint} className="word-hint-slots">
      {[...hint].map((character, index) => (
        <span
          aria-hidden="true"
          className={`word-hint-slot${character === "_" ? " hidden" : ""}${character === " " ? " space" : ""}`}
          key={`${character}-${index}`}
        >
          {character === " " ? "" : character}
        </span>
      ))}
    </span>
  );
}

function toLogicalPoint(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1000, ((clientX - rect.left) / rect.width) * 1000)),
    y: Math.max(0, Math.min(1000, ((clientY - rect.top) / rect.height) * 1000))
  };
}

function canCommitDraft(snapshot: ClientSnapshot | undefined, canDraw: boolean, draft?: Stroke): boolean {
  if (!draft) return false;
  if (canDraw) return true;
  const startedAt = draft.startedAt ?? Date.now();
  if (snapshot?.phase === "DRAW_GUESS") return startedAt <= snapshot.phaseEndsAt;
  return snapshot?.phase === "SHIP_REVEAL" || snapshot?.phase === "REVEAL_HOLD";
}

function createFloodFillStroke(strokes: Stroke[], point: { x: number; y: number }, color: string, width: number): Stroke | undefined {
  const boundaryCanvas = document.createElement("canvas");
  boundaryCanvas.width = FILL_RESOLUTION;
  boundaryCanvas.height = FILL_RESOLUTION;
  const boundaryContext = boundaryCanvas.getContext("2d");
  if (!boundaryContext) return undefined;

  const scale = FILL_RESOLUTION / 1000;
  boundaryContext.lineCap = "round";
  boundaryContext.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.op === "fill" || stroke.points.length < 2) continue;
    boundaryContext.globalCompositeOperation = stroke.op === "erase" ? "destination-out" : "source-over";
    boundaryContext.strokeStyle = "#000000";
    boundaryContext.lineWidth = Math.max(1, stroke.width * 2.5 * FILL_BOUNDARY_WIDTH_RATIO * scale);
    boundaryContext.beginPath();
    boundaryContext.moveTo(stroke.points[0]!.x * scale, stroke.points[0]!.y * scale);
    for (const strokePoint of stroke.points.slice(1)) {
      boundaryContext.lineTo(strokePoint.x * scale, strokePoint.y * scale);
    }
    boundaryContext.stroke();
  }
  boundaryContext.globalCompositeOperation = "source-over";

  const boundaryData = boundaryContext.getImageData(0, 0, FILL_RESOLUTION, FILL_RESOLUTION).data;
  if (!hasBoundaryPixels(boundaryData)) {
    return {
      id: crypto.randomUUID(),
      points: [],
      color,
      width,
      op: "fill"
    };
  }

  const startX = clamp(Math.floor(point.x * scale), 0, FILL_RESOLUTION - 1);
  const startY = clamp(Math.floor(point.y * scale), 0, FILL_RESOLUTION - 1);
  const startIndex = startY * FILL_RESOLUTION + startX;
  if (isBoundary(boundaryData, startIndex)) return undefined;

  const fillCanvas = document.createElement("canvas");
  fillCanvas.width = FILL_RESOLUTION;
  fillCanvas.height = FILL_RESOLUTION;
  const fillContext = fillCanvas.getContext("2d");
  if (!fillContext) return undefined;

  const fillImage = fillContext.createImageData(FILL_RESOLUTION, FILL_RESOLUTION);
  const fillData = fillImage.data;
  const rgb = parseHexColor(color);
  const visited = new Uint8Array(FILL_RESOLUTION * FILL_RESOLUTION);
  const stack = new Int32Array(FILL_RESOLUTION * FILL_RESOLUTION);
  let stackLength = 0;
  pushFillCandidate(startIndex);

  while (stackLength > 0) {
    const index = stack[--stackLength]!;
    paintFillPixel(fillData, index, rgb);

    const x = index % FILL_RESOLUTION;
    if (x > 0) pushFillCandidate(index - 1);
    if (x < FILL_RESOLUTION - 1) pushFillCandidate(index + 1);
    if (index >= FILL_RESOLUTION) pushFillCandidate(index - FILL_RESOLUTION);
    if (index < FILL_RESOLUTION * (FILL_RESOLUTION - 1)) pushFillCandidate(index + FILL_RESOLUTION);
  }

  paintBoundaryJoin(fillData, boundaryData, visited, rgb);
  fillContext.putImageData(fillImage, 0, 0);
  return {
    id: crypto.randomUUID(),
    points: [point],
    color,
    width,
    op: "fill",
    image: fillCanvas.toDataURL("image/png")
  };

  function pushFillCandidate(index: number) {
    if (visited[index] || isBoundary(boundaryData, index)) return;
    visited[index] = 1;
    stack[stackLength++] = index;
  }
}

function hasBoundaryPixels(data: Uint8ClampedArray) {
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) > 0) return true;
  }
  return false;
}

function isBoundary(data: Uint8ClampedArray, pixelIndex: number) {
  return (data[pixelIndex * 4 + 3] ?? 0) > BOUNDARY_ALPHA_THRESHOLD;
}

function paintBoundaryJoin(
  fillData: Uint8ClampedArray,
  boundaryData: Uint8ClampedArray,
  visited: Uint8Array,
  rgb: { r: number; g: number; b: number }
) {
  const joinPixels = new Uint8Array(FILL_RESOLUTION * FILL_RESOLUTION);

  for (let index = 0; index < visited.length; index += 1) {
    if (!visited[index]) continue;
    const x = index % FILL_RESOLUTION;
    const y = Math.floor(index / FILL_RESOLUTION);
    for (let dy = -FILL_JOIN_RADIUS; dy <= FILL_JOIN_RADIUS; dy += 1) {
      for (let dx = -FILL_JOIN_RADIUS; dx <= FILL_JOIN_RADIUS; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > FILL_JOIN_RADIUS) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= FILL_RESOLUTION || nextY < 0 || nextY >= FILL_RESOLUTION) continue;
        const nextIndex = nextY * FILL_RESOLUTION + nextX;
        if (isBoundary(boundaryData, nextIndex)) joinPixels[nextIndex] = 1;
      }
    }
  }

  for (let index = 0; index < joinPixels.length; index += 1) {
    if (joinPixels[index]) paintFillPixel(fillData, index, rgb);
  }
}

function paintFillPixel(data: Uint8ClampedArray, pixelIndex: number, rgb: { r: number; g: number; b: number }) {
  const dataIndex = pixelIndex * 4;
  data[dataIndex] = rgb.r;
  data[dataIndex + 1] = rgb.g;
  data[dataIndex + 2] = rgb.b;
  data[dataIndex + 3] = 255;
}

function parseHexColor(color: string) {
  const hex = color.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
