"use client";

import { ClipboardList, Mail } from "lucide-react";
import type { BoundaryPromptPayload } from "@special-delivery/shared/events";
import { useRef } from "react";
import { useGsapAnimation } from "../useGsapAnimation";

export function BoundaryDecision({
  onPick,
  prompt
}: {
  onPick: (choice: BoundaryPromptPayload["options"][number]["value"]) => void;
  prompt: BoundaryPromptPayload;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const title = prompt.kind === "postageClass" ? "Choose the next timer class" : "Choose the next mail type";
  const eyebrow = prompt.kind === "postageClass" ? "Timer route" : "Mail route";
  const Icon = prompt.kind === "postageClass" ? ClipboardList : Mail;

  useGsapAnimation(overlayRef, [prompt.promptId], (gsap) => {
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .fromTo(".boundary-decision-panel", { autoAlpha: 0, y: 18, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28 })
      .from(".boundary-decision-option", { autoAlpha: 0, y: 14, duration: 0.22, stagger: 0.05 }, 0.12);
  });

  return (
    <div className="boundary-decision-overlay" ref={overlayRef}>
      <div className="panel stack boundary-decision-panel">
        <div className="boundary-decision-heading">
          <span aria-hidden="true" className="boundary-decision-icon">
            <Icon size={26} />
          </span>
          <div>
            <span>{eyebrow}</span>
            <h2 className="section-title">{title}</h2>
          </div>
        </div>
        <div className="boundary-decision-options">
          {prompt.options.map((option) => (
            <button
              className="secondary-button boundary-decision-option"
              key={option.value}
              onClick={() => onPick(option.value)}
              type="button"
            >
              <span>{option.label}</span>
              <small>{option.helper}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
