-- Leaderboard table for Reach the Relay.
-- Apply to the D1 database with:
--   wrangler d1 execute reach-relay-leaderboard --file=worker/schema.sql --remote

CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 16),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 1500),
  leader_id TEXT NOT NULL CHECK (leader_id IN ('vanguard','netrunner','medic','scavenger','cybermonk')),
  route TEXT NOT NULL CHECK (route IN ('long-highway','transit-line','direct-line')),
  duration_sec INTEGER NOT NULL CHECK (duration_sec >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Score-sorted index for "top N overall" queries.
CREATE INDEX IF NOT EXISTS leaderboard_score_idx ON leaderboard (score DESC);

-- Composite index for "top N on route X" queries — the common filter.
CREATE INDEX IF NOT EXISTS leaderboard_route_score_idx ON leaderboard (route, score DESC);
