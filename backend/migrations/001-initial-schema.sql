CREATE TABLE IF NOT EXISTS debug_attempts (
  id               SERIAL PRIMARY KEY,
  repo_full_name   TEXT NOT NULL,
  commit_sha       TEXT NOT NULL,
  attempt_number   INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  status           TEXT NOT NULL DEFAULT 'in_progress',
  debugger_used    TEXT,
  fix_commit_sha   TEXT,
  fix_commit_url   TEXT,
  fix_branch       TEXT,
  fix_pr_url       TEXT,
  failure_reason   TEXT,
  build_provider   TEXT,
  build_url        TEXT,
  high_risk        BOOLEAN NOT NULL DEFAULT false,
  high_risk_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debug_attempts_repo_commit
  ON debug_attempts (repo_full_name, commit_sha);

CREATE TABLE IF NOT EXISTS build_poll_jobs (
  id              SERIAL PRIMARY KEY,
  job_id          TEXT NOT NULL UNIQUE,
  repo_full_name  TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  providers       TEXT[] NOT NULL DEFAULT '{}',
  attempt_number  INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 20,
  status          TEXT NOT NULL DEFAULT 'pending',
  result          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
