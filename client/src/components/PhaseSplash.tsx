"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAIL_TYPE_LABEL } from "@special-delivery/shared";
import type { ClientSnapshot, PhaseIntroKind } from "@special-delivery/shared";
import { phaseIsBriefing } from "../phase";
import { playCue, type Cue } from "../audio";
import { useGsapAnimation } from "../useGsapAnimation";

export function PhaseSplash({ snapshot }: { snapshot: ClientSnapshot }) {
  const [now, setNow] = useState(() => Date.now());
  const playedIntroId = useRef<string | undefined>(undefined);
  const splashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(interval);
  }, []);

  const intro = snapshot.phaseIntro;
  const roleCards = useMemo(() => ownTeamRoles(snapshot), [snapshot]);
  const seconds = intro ? Math.max(1, Math.ceil((intro.endsAt - now) / 1000)) : 0;

  useEffect(() => {
    if (!intro || playedIntroId.current === intro.id || !phaseIsBriefing(snapshot)) return;
    playedIntroId.current = intro.id;
    playCue(introCue(intro.kind));
  }, [intro, snapshot]);

  useGsapAnimation(splashRef, [intro?.id], (gsap) => {
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .fromTo(".phase-splash-overlay", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18 })
      .from(".phase-countdown", { scale: 0.72, rotate: -4, y: -18, duration: 0.42, ease: "back.out(1.8)" }, 0.02)
      .from(".phase-splash-kicker", { autoAlpha: 0, y: 12, duration: 0.26 }, 0.08)
      .from(".phase-splash-card h2", { autoAlpha: 0, y: 28, scale: 0.96, duration: 0.38 }, 0.14)
      .from(".phase-splash-subtitle, .phase-splash-body, .phase-splash-role", { autoAlpha: 0, y: 16, duration: 0.3, stagger: 0.06 }, 0.22)
      .from(".phase-role-card", { autoAlpha: 0, y: 18, scale: 0.97, duration: 0.34, stagger: 0.08 }, 0.34);
  });

  useGsapAnimation(splashRef, [seconds], (gsap) => {
    gsap.fromTo(
      ".phase-countdown strong",
      { scale: 0.72, color: "#fffaf0" },
      { scale: 1, color: "#e6aa3f", duration: 0.28, ease: "back.out(2)" }
    );
  });

  if (!intro || !phaseIsBriefing(snapshot, now)) return null;

  const roleCopy = roleInstruction(snapshot);
  const countdownLabel = `Phase starts in ${seconds} seconds`;

  return (
    <div className="phase-splash-overlay" aria-live="polite" ref={splashRef}>
      <div className="phase-splash-card">
        <div className="phase-countdown" aria-label={countdownLabel}>
          <span>Starts in</span>
          <strong>{seconds}</strong>
        </div>
        <div className="phase-splash-kicker">
          Round {snapshot.roundIndex + 1} · {MAIL_TYPE_LABEL[snapshot.mailType]} · {snapshot.postageClass.replace("_", " ")}
        </div>
        <h2>{intro.title}</h2>
        {intro.subtitle ? <p className="phase-splash-subtitle">{intro.subtitle}</p> : null}
        <p className="phase-splash-body">{intro.body}</p>
        <div className="phase-splash-role">
          <span>Your station</span>
          <strong>{roleCopy.title}</strong>
          <p>{roleCopy.body}</p>
        </div>
        <div className="phase-role-grid">
          <div className="phase-role-stack">
            {roleCards.slice(0, 2).map((card) => (
              <RoleCard card={card} key={card.label} />
            ))}
          </div>
          {roleCards.slice(2).map((card) => (
            <RoleCard card={card} className="crew-role-card" key={card.label} />
          ))}
        </div>
      </div>
    </div>
  );
}

type RoleCardModel = {
  active: boolean;
  label: string;
  names: string[];
};

function RoleCard({ card, className = "" }: { card: RoleCardModel; className?: string }) {
  return (
    <div className={["phase-role-card", card.active ? "active" : "", className].filter(Boolean).join(" ")}>
      <span>{card.label}</span>
      <div className="phase-role-names">
        {card.names.map((name, index) => (
          <strong key={`${card.label}-${name}-${index}`}>{name}</strong>
        ))}
      </div>
    </div>
  );
}

function introCue(kind: PhaseIntroKind): Cue {
  if (kind === "CLOSING_TIME") return "closing-time";
  if (kind === "DRAW_START") return "draw-start";
  if (kind === "SCRAMBLE_START") return "scramble-start";
  if (kind === "ROUND_START") return "manifest-open";
  return "phase-intro";
}

function ownTeamRoles(snapshot: ClientSnapshot): RoleCardModel[] {
  const nameFor = (playerId: string) =>
    snapshot.ownBranch.players.find((player) => player.id === playerId)?.nickname ?? "Unassigned";
  const crew = snapshot.ownBranch.players.filter(
    (player) => player.id !== snapshot.ownBranch.postmasterId && player.id !== snapshot.ownBranch.mailmanId
  );
  return [
    {
      label: "Postmaster",
      names: [nameFor(snapshot.ownBranch.postmasterId)],
      active: snapshot.role === "POSTMASTER"
    },
    {
      label: "Mailman",
      names: [nameFor(snapshot.ownBranch.mailmanId)],
      active: snapshot.role === "MAILMAN"
    },
    {
      label: "Crew",
      names: crew.length > 0 ? crew.map((player) => player.nickname) : ["Unassigned"],
      active: snapshot.role === "CREW"
    }
  ];
}

function roleInstruction(snapshot: ClientSnapshot): { title: string; body: string } {
  if (snapshot.phase === "MANIFEST") {
    if (snapshot.role === "POSTMASTER") {
      return {
        title: "Postmaster",
        body: "Rank the manifest from best to worst. If both branches line up, everyone draws the same word."
      };
    }
    return {
      title: snapshot.role,
      body: "Postmasters are choosing the word. Watch the role board and get ready for the next station."
    };
  }

  if (snapshot.phase === "DRAW_GUESS") {
    if (snapshot.role === "POSTMASTER") {
      return {
        title: "Postmaster",
        body: `Draw ${snapshot.ownBranch.word?.toUpperCase() ?? "the manifest word"} when the horn clears.`
      };
    }
    if (snapshot.role === "MAILMAN") {
      return {
        title: "Mailman",
        body: "Watch the warmth gauges and ship when the route feels valuable enough."
      };
    }
    return {
      title: "Crew",
      body: "Guess in Regional chat. The word hint will reveal random letters as the timer runs."
    };
  }

  if (snapshot.phase === "SCRAMBLE") {
    return {
      title: "Sorting crew",
      body: "Drag each spilled piece into its matching mail bin before the timer expires."
    };
  }

  return {
    title: snapshot.role,
    body: "I am moving the route to the next station."
  };
}
