# Special Delivery

A real-time, two-team draw-and-guess party game about rival post office branches,
MARV the anxious sorting robot, blanked mail, and very dramatic shipping
decisions.

This repo follows the build spec in `special-delivery-build-spec-v0.4.md`:

- `shared/` contains the authoritative types, event contract, constants, and word
  list.
- `server/` contains the Socket.IO authoritative game server, telemetry, bots,
  and self-play harness.
- `client/` contains the Next.js client for lobby, match play, drawing, guessing,
  Regional chat actions, reveal, scramble, and staff board surfaces.

## Quick Start

```bash
corepack enable
corepack prepare pnpm@10.25.0 --activate
corepack pnpm install
corepack pnpm selfplay
corepack pnpm dev
```

The local client defaults to `http://localhost:3000` and the real-time server to
`http://localhost:4000`.

## Solo Playtest

Join a lobby in the browser, then use `Solo quick test` or `Solo full test`.
Solo mode keeps one real player on North Loop Branch and fills every other seat
with MARVbots. Your role cycles by round through Postmaster, Crew, and Mailman.

The bots lock manifests, guess words, ship from bot route actions, pick boundaries,
and sort scramble pieces. Bot Postmasters do not draw; when you are Crew and a
bot Postmaster owns the drawing station, MARV posts a private solo clue so you
can still test guessing and warmth flow.
