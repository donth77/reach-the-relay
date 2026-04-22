# Leaderboard Worker

Cloudflare Worker + D1 database powering the Reach the Relay leaderboard.

Deployed separately from the game client. The game hits this Worker over HTTPS
from wherever it's hosted (itch.io, Vercel, etc.) — CORS is wide open so the
Worker works regardless of origin.

## One-time setup

From the repo root:

```bash
cd worker
npm install
npx wrangler login        # opens browser to link your Cloudflare account
npx wrangler d1 create reach-relay-leaderboard
```

The `d1 create` command prints a `database_id`. Copy it into `wrangler.toml`,
replacing the `PASTE_FROM_wrangler_d1_create_OUTPUT` placeholder.

Then apply the schema:

```bash
npm run schema:apply
```

Deploy the Worker:

```bash
npm run deploy
```

Wrangler prints the Worker URL — something like
`https://reach-relay-leaderboard.<account>.workers.dev`. Paste that into the
game's repo-root `.env` as `VITE_LEADERBOARD_API=...`.

## Endpoints

- `POST /submit` — body: `{ username, score, leaderId, route, durationSec }`.
  Returns `{ ok: true, rank }` on success, or `{ error }` on validation /
  DB failure.
- `GET /top?route=<id>&limit=<n>` — route is optional (omit for global top).
  Returns `{ entries: [...] }` sorted by `score DESC, duration_sec ASC`.

## Local iteration

`npm run dev` runs the Worker on `localhost:8787` with a local D1 instance.
Apply the schema to the local DB with `npm run schema:apply-local` first.

## Costs

All free tier:
- Workers: 100k requests/day
- D1: 5M row reads/day, 100k row writes/day, 5 GB storage

A jam leaderboard won't come close to any of these.
