"use client";

import { useEffect, useState } from "react";
import type { ClientSnapshot } from "@special-delivery/shared";
import { phaseIsActive } from "./phase";

export function usePhaseActive(snapshot?: ClientSnapshot): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!snapshot) return;
    const currentNow = Date.now();
    const needsClock =
      currentNow < snapshot.phaseStartedAt ||
      (snapshot.phaseEndsAt > snapshot.phaseStartedAt && currentNow <= snapshot.phaseEndsAt);
    if (!needsClock) return;
    const interval = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= snapshot.phaseStartedAt && snapshot.phaseEndsAt > snapshot.phaseStartedAt && nextNow > snapshot.phaseEndsAt) {
        window.clearInterval(interval);
      }
    }, 120);
    return () => window.clearInterval(interval);
  }, [snapshot?.phase, snapshot?.phaseStartedAt, snapshot?.phaseEndsAt, snapshot?.phaseIntro?.id]);

  return phaseIsActive(snapshot, now);
}
