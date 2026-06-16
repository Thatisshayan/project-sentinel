#!/usr/bin/env node
/**
 * Closed-loop smoke checker.
 * Usage: DATABASE_URL=<url> TARGET_REPO=<repoName> node scripts/check-loop.js
 * Exit 0  → all checks pass (loop is proven end-to-end for TARGET_REPO)
 * Exit 1  → one or more checks failed (see report)
 */

const { Client } = require('pg');

const TARGET_REPO = process.env.TARGET_REPO;
if (!TARGET_REPO) {
  console.error('ERROR: TARGET_REPO env var required (e.g. TARGET_REPO=tapcash)');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const checks = [];

  try {
    // 1. Processed commits in last 24h for TARGET_REPO
    const commits = await client.query(`
      SELECT COUNT(*) AS cnt FROM processed_commits
      WHERE repo_name = $1 AND processed_at > NOW() - INTERVAL '24 hours'
    `, [TARGET_REPO]);
    const commitCount = parseInt(commits.rows[0]?.cnt || 0);
    checks.push({
      name:   'processed_commits (last 24h)',
      passed: commitCount > 0,
      value:  commitCount,
    });

    // 2. portfolio_metrics.last_commit_at is non-null for TARGET_REPO
    const metrics = await client.query(`
      SELECT last_commit_at FROM portfolio_metrics
      WHERE repo_name = $1
      ORDER BY recorded_at DESC LIMIT 1
    `, [TARGET_REPO]);
    const lastCommit = metrics.rows[0]?.last_commit_at;
    checks.push({
      name:   'portfolio_metrics.last_commit_at',
      passed: !!lastCommit,
      value:  lastCommit ? lastCommit.toISOString() : 'NULL',
    });

    // 3. Audit tasks done for TARGET_REPO
    const tasks = await client.query(`
      SELECT COUNT(*) AS cnt FROM audit_tasks
      WHERE repo_full_name LIKE $1 AND status = 'done'
    `, [`%/${TARGET_REPO}`]);
    const doneCount = parseInt(tasks.rows[0]?.cnt || 0);
    checks.push({
      name:   'audit_tasks done',
      passed: doneCount > 0,
      value:  doneCount,
    });

    // 4. build_poll_jobs exist for TARGET_REPO
    const polls = await client.query(`
      SELECT COUNT(*) AS cnt FROM build_poll_jobs
      WHERE repo_full_name LIKE $1
    `, [`%/${TARGET_REPO}`]);
    const pollCount = parseInt(polls.rows[0]?.cnt || 0);
    checks.push({
      name:   'build_poll_jobs',
      passed: pollCount > 0,
      value:  pollCount,
    });
  } finally {
    await client.end();
  }

  const passed = checks.filter(c => c.passed);
  const failed = checks.filter(c => !c.passed);

  console.log(`\nClosed-loop check for: ${TARGET_REPO}\n`);
  for (const c of checks) {
    const icon = c.passed ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}: ${c.value}`);
  }
  console.log(`\n${passed.length}/${checks.length} checks passed`);

  if (failed.length > 0) {
    console.log('\nFailed checks:');
    for (const c of failed) {
      console.log(`  - ${c.name} (got: ${c.value})`);
    }
    process.exit(1);
  }

  console.log('\nLoop proven ✅');
  process.exit(0);
}

main().catch(err => {
  console.error('Check script error:', err.message);
  process.exit(1);
});
