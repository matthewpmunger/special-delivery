"use client";

import { useLayoutEffect } from "react";
import { gsap } from "gsap";
import type { DependencyList, RefObject } from "react";

type AnimationScope = RefObject<HTMLElement | null>;

gsap.config({ nullTargetWarn: false });

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useGsapAnimation(
  scope: AnimationScope,
  dependencies: DependencyList,
  animate: (gsapInstance: typeof gsap, root: HTMLElement) => void
): void {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || prefersReducedMotion()) return undefined;
    const context = gsap.context(() => animate(gsap, root), root);
    return () => context.revert();
  }, dependencies);
}
