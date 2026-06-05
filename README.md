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

## Deploying the Socket Server

The Railway service should deploy from the repository root so the server can
resolve the `shared/` workspace package. The root `railway.json` points Railway
at the server package and configures `/health` as the deploy healthcheck.

Set these Railway variables:

```bash
CLIENT_ORIGIN=https://your-webflow-app-domain,http://localhost:3000
MATCH_TIMER_SCALE=1
```

`CLIENT_ORIGIN` should be the browser origin only. If the Webflow app lives at
`https://example.webflow.io/special-delivery`, use `https://example.webflow.io`.

Optional, if you attach a Railway volume for telemetry:

```bash
SQLITE_PATH=/data/telemetry.sqlite
```

After Railway gives you a public domain, set the frontend runtime variable to
that URL:

```bash
RT_SERVER_URL=https://your-railway-server-domain
```

## Deploying the Webflow Cloud Client

When connecting this monorepo to Webflow Cloud, set the app directory path to
`/client`. The Next.js app's `package.json`, `webflow.json`, `wrangler.json`,
and OpenNext config all live in that folder.

Webflow builds `/client` as a standalone app, so the client vendors a copy of the
shared event/type contract in `client/shared`.

## Solo Playtest

Join a lobby in the browser, then use `Solo quick test` or `Solo full test`.
Solo mode keeps one real player on North Loop Branch and fills every other seat
with MARVbots. Your role cycles by round through Postmaster, Crew, and Mailman.

The bots lock manifests, guess words, ship from bot route actions, pick boundaries,
and sort scramble pieces. Bot Postmasters do not draw; when you are Crew and a
bot Postmaster owns the drawing station, MARV posts a private solo clue so you
can still test guessing and warmth flow.
