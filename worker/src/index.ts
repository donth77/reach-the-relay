// Reach the Relay — leaderboard Worker.
//
// Three routes:
//   POST /submit  — insert a score, return the player's rank on that route
//   GET  /top     — fetch top-N scores, optionally filtered by route
//   OPTIONS *     — CORS preflight
//
// All state lives in D1 (binding = DB). No auth — rely on check constraints
// + client-side gating (submit only on verified victory) for a jam-grade
// defense. Input validation is strict enough to block browser-console
// tampering of raw payloads.

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  DB: D1Database;
  // Cloudflare-native rate limiter (configured in wrangler.toml).
  RATE_LIMITER: RateLimiter;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_ROUTES = ['long-highway', 'transit-line', 'direct-line'];
const VALID_LEADERS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'];
// Alphanumeric + space + underscore, 1–16 chars. Mirrors the CHECK
// constraint on the `username` column so client + server agree on shape.
const USERNAME_RE = /^[A-Za-z0-9 _]{1,16}$/;

interface SubmitBody {
  username: unknown;
  score: unknown;
  leaderId: unknown;
  route: unknown;
  durationSec: unknown;
}

interface LeaderboardRow {
  username: string;
  score: number;
  leader_id: string;
  route: string;
  duration_sec: number;
  created_at: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method === 'POST' && url.pathname === '/submit') {
      // Per-IP rate limit: 1 submit / 60 s (configured in wrangler.toml).
      // Legit runs take 3–6 min so this never affects real players; stops
      // console-tampering floods cold.
      const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
      const rl = await env.RATE_LIMITER.limit({ key: ip });
      if (!rl.success) {
        return json(429, { error: 'rate_limited' });
      }

      let body: SubmitBody;
      try {
        body = await req.json<SubmitBody>();
      } catch {
        return json(400, { error: 'invalid_json' });
      }

      // Strict validation — reject anything that doesn't match the shape
      // we expect AND the CHECK constraints in the D1 schema. Returning
      // early with a clear error makes client-side debugging easier.
      //
      // Score cap = 1100: true max is 260 (HP base) + 800 (hard-route
      // bonus) = 1060. 40-point buffer for any scoring tweaks.
      if (
        typeof body.username !== 'string' ||
        !USERNAME_RE.test(body.username) ||
        typeof body.score !== 'number' ||
        !Number.isFinite(body.score) ||
        body.score < 0 ||
        body.score > 1100 ||
        typeof body.leaderId !== 'string' ||
        !VALID_LEADERS.includes(body.leaderId) ||
        typeof body.route !== 'string' ||
        !VALID_ROUTES.includes(body.route) ||
        typeof body.durationSec !== 'number' ||
        !Number.isFinite(body.durationSec) ||
        body.durationSec < 0 ||
        body.durationSec > 100000 // sanity cap: ~27 hours
      ) {
        return json(400, { error: 'invalid_payload' });
      }

      try {
        await env.DB.prepare(
          'INSERT INTO leaderboard (username, score, leader_id, route, duration_sec) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(
            body.username,
            Math.floor(body.score),
            body.leaderId,
            body.route,
            Math.floor(body.durationSec),
          )
          .run();

        // Rank = count of entries on the SAME ROUTE with a strictly higher
        // score, plus 1. Ties break by faster duration (lower rank = better
        // run), matching the /top sort order.
        const rankRow = await env.DB.prepare(
          `SELECT COUNT(*) + 1 AS rank
             FROM leaderboard
            WHERE route = ?
              AND (score > ?
                   OR (score = ? AND duration_sec < ?))`,
        )
          .bind(body.route, body.score, body.score, body.durationSec)
          .first<{ rank: number }>();

        return json(200, { ok: true, rank: rankRow?.rank ?? null });
      } catch (err) {
        return json(500, { error: 'db_error', detail: String(err) });
      }
    }

    if (req.method === 'GET' && url.pathname === '/top') {
      const route = url.searchParams.get('route'); // null = all routes
      if (route !== null && !VALID_ROUTES.includes(route)) {
        return json(400, { error: 'invalid_route' });
      }
      const rawLimit = Number(url.searchParams.get('limit') ?? 50);
      const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50), 100);

      try {
        const query = route
          ? env.DB.prepare(
              `SELECT username, score, leader_id, route, duration_sec, created_at
                 FROM leaderboard
                WHERE route = ?
                ORDER BY score DESC, duration_sec ASC
                LIMIT ?`,
            ).bind(route, limit)
          : env.DB.prepare(
              `SELECT username, score, leader_id, route, duration_sec, created_at
                 FROM leaderboard
                ORDER BY score DESC, duration_sec ASC
                LIMIT ?`,
            ).bind(limit);

        const { results } = await query.all<LeaderboardRow>();
        return json(200, { entries: results });
      } catch (err) {
        return json(500, { error: 'db_error', detail: String(err) });
      }
    }

    return json(404, { error: 'not_found' });
  },
};
