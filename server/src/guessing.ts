import { distance } from "fastest-levenshtein";
import type { WarmthBand, WarmthSummary, WordEntry } from "@special-delivery/shared";

const SPELLING_VARIANTS = new Map<string, string>([
  ["grey", "gray"],
  ["omelet", "omelette"],
  ["harbour", "harbor"],
  ["colour", "color"]
]);

const BAND_SCORE: Record<WarmthBand, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CORRECT: 3
};

export function normalizeGuess(input: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SPELLING_VARIANTS.get(normalized) ?? normalized;
}

function singularize(input: string): string {
  if (input.endsWith("ies") && input.length > 4) return `${input.slice(0, -3)}y`;
  if (input.endsWith("es") && input.length > 4) return input.slice(0, -2);
  if (input.endsWith("s") && input.length > 3) return input.slice(0, -1);
  return input;
}

function canonicalForms(input: string): Set<string> {
  const normalized = normalizeGuess(input);
  const singular = singularize(normalized);
  return new Set([normalized, singular, normalized.replace(/\s/g, ""), singular.replace(/\s/g, "")]);
}

export function correctForms(word: Pick<WordEntry, "text" | "aliases">): Set<string> {
  const forms = canonicalForms(word.text);
  for (const alias of word.aliases) {
    for (const form of canonicalForms(alias)) forms.add(form);
  }
  return forms;
}

export interface GuessCheck {
  result: "correct" | "close" | "wrong";
  warmth: WarmthBand;
  normalizedGuess: string;
  distance: number;
}

export function checkGuess(word: Pick<WordEntry, "text" | "aliases">, rawGuess: string): GuessCheck {
  const normalizedGuess = normalizeGuess(rawGuess);
  if (!normalizedGuess) return { result: "wrong", warmth: "LOW", normalizedGuess, distance: Infinity };
  const targets = correctForms(word);
  const compactGuess = normalizedGuess.replace(/\s/g, "");
  if (targets.has(normalizedGuess) || targets.has(compactGuess) || targets.has(singularize(normalizedGuess))) {
    return { result: "correct", warmth: "CORRECT", normalizedGuess, distance: 0 };
  }

  const distances = [...targets].map((target) => distance(compactGuess, target.replace(/\s/g, "")));
  const bestDistance = Math.min(...distances);
  const targetLength = Math.max(1, [...targets].sort((a, b) => a.length - b.length)[0]?.length ?? 1);
  const closeThreshold = Math.max(1, Math.floor(targetLength * 0.25));
  const mediumThreshold = Math.max(closeThreshold + 1, Math.ceil(targetLength * 0.42));

  if (bestDistance <= closeThreshold) {
    return { result: "close", warmth: "HIGH", normalizedGuess, distance: bestDistance };
  }
  if (bestDistance <= mediumThreshold) {
    return { result: "wrong", warmth: "MEDIUM", normalizedGuess, distance: bestDistance };
  }
  return { result: "wrong", warmth: "LOW", normalizedGuess, distance: bestDistance };
}

export function summarizeWarmth(
  current: Record<string, WarmthBand>,
  previous: Record<string, WarmthBand>,
  eligiblePlayerIds: string[]
): WarmthSummary {
  const summary: WarmthSummary = { correct: 0, high: 0, medium: 0, low: 0, warming: 0, cooling: 0 };
  for (const playerId of eligiblePlayerIds) {
    const band = current[playerId] ?? "LOW";
    if (band === "CORRECT") summary.correct += 1;
    if (band === "HIGH") summary.high += 1;
    if (band === "MEDIUM") summary.medium += 1;
    if (band === "LOW") summary.low += 1;

    const prior = previous[playerId] ?? "LOW";
    if (BAND_SCORE[band] > BAND_SCORE[prior]) summary.warming += 1;
    if (BAND_SCORE[band] < BAND_SCORE[prior]) summary.cooling += 1;
  }
  return summary;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number
  ) {}

  accept(key: string, now = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts >= windowStart);
    if (recent.length >= this.maxHits) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
