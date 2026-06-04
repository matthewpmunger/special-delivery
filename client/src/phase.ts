import type { ClientSnapshot, Phase } from "@special-delivery/shared";

export function phaseIsActive(snapshot?: ClientSnapshot, now = Date.now()): boolean {
  if (!snapshot || now < snapshot.phaseStartedAt) return !snapshot;
  return snapshot.phaseEndsAt <= snapshot.phaseStartedAt || now <= snapshot.phaseEndsAt;
}

export function phaseIsBriefing(snapshot?: ClientSnapshot, now = Date.now()): boolean {
  return Boolean(snapshot?.phaseIntro && snapshot.phaseIntro.endsAt > now && now < snapshot.phaseStartedAt);
}

export function phaseLabel(phase: Phase): string {
  return phase.replace("_", " ");
}
