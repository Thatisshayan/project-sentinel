import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

async function initSecuritySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS security_scans (
      id                SERIAL PRIMARY KEY,
      repo_full_name    TEXT NOT NULL,
      commit_sha        TEXT NOT NULL,
      branch_name       TEXT,
      security_score    NUMERIC(4,1),
      vulnerabilities   INTEGER DEFAULT 0,
      secrets_found     INTEGER DEFAULT 0,
      owasp_score       NUMERIC(4,1),
      scan_duration_ms  INTEGER,
      status            TEXT NOT NULL DEFAULT 'running',
      triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at      TIMESTAMPTZ
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_security_scans_repo
      ON security_scans (repo_full_name, triggered_at DESC);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS security_issues (
      id                SERIAL PRIMARY KEY,
      scan_id           INTEGER REFERENCES security_scans(id),
      repo_full_name    TEXT NOT NULL,
      issue_type        TEXT NOT NULL,
      severity          TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT,
      file_path         TEXT,
      line_number       INTEGER,
      cve_id            TEXT,
      cvss_score        NUMERIC(4,1),
      fix_available     BOOLEAN DEFAULT false,
      fix_description   TEXT,
      auto_fixable      BOOLEAN DEFAULT false,
      status            TEXT NOT NULL DEFAULT 'open',
      found_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at       TIMESTAMPTZ
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_security_issues_repo
      ON security_issues (repo_full_name, severity, status, found_at DESC);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS security_scores (
      id              SERIAL PRIMARY KEY,
      repo_name       TEXT NOT NULL,
      score           NUMERIC(4,1) NOT NULL,
      vulnerabilities INTEGER DEFAULT 0,
      critical_count  INTEGER DEFAULT 0,
      high_count      INTEGER DEFAULT 0,
      medium_count    INTEGER DEFAULT 0,
      low_count       INTEGER DEFAULT 0,
      recorded_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_scores_unique
      ON security_scores (repo_name, recorded_date);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS owasp_checklist (
      id              SERIAL PRIMARY KEY,
      repo_name       TEXT NOT NULL,
      owasp_item      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TIMESTAMPTZ,
      notes           TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owasp_unique
      ON owasp_checklist (repo_name, owasp_item);
  `);
  logger.info('Security schema initialised');
}

async function createSecurityScan(data: {
  repoFullName: string; commitSha: string; branchName?: string;
}): Promise<any> {
  const r = await query(`
    INSERT INTO security_scans (repo_full_name, commit_sha, branch_name, status)
    VALUES ($1, $2, $3, 'running') RETURNING *
  `, [data.repoFullName, data.commitSha, data.branchName || 'main']);
  return r.rows[0];
}

async function updateSecurityScan(id: number, updates: Record<string, any>): Promise<any | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE security_scans SET ${fields} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

async function insertSecurityIssue(data: {
  scanId: number; repoFullName: string; issueType: string; severity: string;
  title: string; description?: string; filePath?: string; lineNumber?: number;
  cveId?: string; cvssScore?: number; fixAvailable?: boolean;
  fixDescription?: string; autoFixable?: boolean;
}): Promise<number | undefined> {
  const r = await query(`
    INSERT INTO security_issues
      (scan_id, repo_full_name, issue_type, severity, title, description,
       file_path, line_number, cve_id, cvss_score, fix_available,
       fix_description, auto_fixable)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id
  `, [
    data.scanId, data.repoFullName, data.issueType, data.severity,
    data.title, data.description || null, data.filePath || null,
    data.lineNumber || null, data.cveId || null, data.cvssScore || null,
    data.fixAvailable || false, data.fixDescription || null,
    data.autoFixable || false,
  ]);
  return r.rows[0]?.id;
}

async function getOpenIssues(repoFullName: string, severity: string | null = null): Promise<any[]> {
  const ORDER = `ORDER BY
    CASE severity
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2
      WHEN 'medium'   THEN 3 WHEN 'low'  THEN 4 ELSE 5
    END, found_at DESC`;

  if (severity) {
    const r = await query(
      `SELECT * FROM security_issues
       WHERE repo_full_name = $1 AND status = 'open' AND severity = $2 ${ORDER}`,
      [repoFullName, severity]
    );
    return r.rows;
  }

  const r = await query(
    `SELECT * FROM security_issues
     WHERE repo_full_name = $1 AND status = 'open' ${ORDER}`,
    [repoFullName]
  );
  return r.rows;
}

async function upsertSecurityScore(repoName: string, data: {
  score: number; vulnerabilities: number; critical: number;
  high: number; medium: number; low: number;
}): Promise<void> {
  await query(`
    INSERT INTO security_scores
      (repo_name, score, vulnerabilities, critical_count,
       high_count, medium_count, low_count, recorded_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE)
    ON CONFLICT (repo_name, recorded_date) DO UPDATE SET
      score=EXCLUDED.score, vulnerabilities=EXCLUDED.vulnerabilities,
      critical_count=EXCLUDED.critical_count, high_count=EXCLUDED.high_count,
      medium_count=EXCLUDED.medium_count, low_count=EXCLUDED.low_count,
      recorded_at=NOW()
  `, [repoName, data.score, data.vulnerabilities,
      data.critical, data.high, data.medium, data.low]);
}

async function upsertOwaspItem(repoName: string, owaspItem: string, status: string, notes?: string): Promise<void> {
  await query(`
    INSERT INTO owasp_checklist (repo_name, owasp_item, status, notes, last_checked_at)
    VALUES ($1,$2,$3,$4,NOW())
    ON CONFLICT (repo_name, owasp_item) DO UPDATE SET
      status=$3, notes=$4, last_checked_at=NOW(), updated_at=NOW()
  `, [repoName, owaspItem, status, notes || null]);
}

async function getLatestSecurityScore(repoName: string): Promise<any | null> {
  const r = await query(`
    SELECT * FROM security_scores WHERE repo_name = $1
    ORDER BY recorded_date DESC LIMIT 1
  `, [repoName]);
  return r.rows[0] || null;
}

async function getPortfolioSecuritySummary(): Promise<any[]> {
  const r = await query(`
    SELECT DISTINCT ON (repo_name)
      repo_name, score, vulnerabilities, critical_count,
      high_count, medium_count, low_count, recorded_date
    FROM security_scores ORDER BY repo_name, recorded_date DESC
  `);
  return r.rows;
}

/**
 * Portfolio-wide count of issues newly found within the last `days` days,
 * grouped by severity. Used by the monthly security report.
 */
async function getIssuesFoundSince(days: number): Promise<Array<{ severity: string; count: number }>> {
  const r = await query(`
    SELECT severity, COUNT(*)::int AS count
    FROM security_issues
    WHERE found_at > NOW() - ($1 || ' days')::INTERVAL
    GROUP BY severity
    ORDER BY CASE severity
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2
      WHEN 'medium'   THEN 3 WHEN 'low'  THEN 4 ELSE 5
    END
  `, [days]);
  return r.rows;
}

/**
 * Portfolio-wide count of issues resolved (status changed away from 'open')
 * within the last `days` days. Used by the monthly security report to show
 * whether the backlog is shrinking or growing.
 */
async function getIssuesResolvedSince(days: number): Promise<number> {
  const r = await query(`
    SELECT COUNT(*)::int AS count
    FROM security_issues
    WHERE status != 'open' AND resolved_at > NOW() - ($1 || ' days')::INTERVAL
  `, [days]);
  return r.rows[0]?.count || 0;
}

export = {
  initSecuritySchema, createSecurityScan, updateSecurityScan,
  insertSecurityIssue, getOpenIssues, upsertSecurityScore,
  upsertOwaspItem, getLatestSecurityScore, getPortfolioSecuritySummary,
  getIssuesFoundSince, getIssuesResolvedSince,
};
