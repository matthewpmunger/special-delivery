import type { BranchId } from "@special-delivery/shared";
import type { MarvPayload } from "@special-delivery/shared/events";

export function marv(
  type: MarvPayload["type"],
  text: string,
  scope: MarvPayload["scope"] = "match"
): MarvPayload {
  return { type, text, scope };
}

export const MARV_LINES = {
  lobbyReady: () => marv("flow", "I opened the sorting floor. Please keep fingers away from the scanner."),
  roundStart: (roundNumber: number) =>
    marv("flow", `Round ${roundNumber} is on the belt. The manifest printer is making confident noises.`),
  noManifestAgreement: () =>
    marv("chaos", "Nobody agreed. Looks like you are each on your own. Sorry! That was probably the scanner."),
  manifestAgreement: (slot: number) => marv("flow", `Manifest aligned on slot ${slot}. I am acting like this was planned.`),
  autoManifest: (branchId: BranchId) =>
    marv("chaos", `Branch ${branchId} did not lock the manifest, so I picked one at random. Very sorry.`),
  ship: (branchId?: BranchId) =>
    marv("result", branchId ? `Branch ${branchId} shipped. Both counters freeze now.` : "Timer expired. Both counters freeze now."),
  autoBoundary: () => marv("chaos", "The boundary pick stalled, so I selected one at random. A tiny scheduling mishap."),
  scrambleStart: () =>
    marv("chaos", "I spilled a fresh truck. Everyone sort the pieces before the clipboard notices."),
  matchEnd: () => marv("result", "Final delivery complete. I prepared the staff board without panicking.")
} as const;
