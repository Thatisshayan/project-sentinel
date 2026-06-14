const { execSync } = require('child_process');
const axios        = require('axios');
const logger       = require('./logger');
const { insertSecurityIssue } = require('./securityDb');

const SENSITIVE_PATHS = [
  'auth','middleware','stripe','paypal','payout','billing',
  'users','firebaseAdmin','firebase-admin','jwt','token',
  '.env','railway.toml','firebase.json',
];

function isSensitiveDep(depName) {
  return SENSITIVE_PATHS.some(p => depName.toLowerCase().includes(p));
}

async function scanDependencies(repoPath, repoFullName, scanId) {
  const issues = [];
  let rawAudit = null;

  try {
    const out = execSync('npm audit --json', {
      cwd: repoPath, timeout: 60000, stdio: ['ignore','pipe','ignore'],
    }).toString();
    rawAudit = JSON.parse(out);
  } catch (err) {
    try { rawAudit = JSON.parse(err.stdout?.toString() || '{}'); }
    catch { logger.warn({ repoFullName }, 'npm audit parse failed'); return []; }
  }

  const vulns = rawAudit.vulnerabilities || {};

  for (const [pkgName, vuln] of Object.entries(vulns)) {
    const severity    = vuln.severity || 'low';
    const fixable     = !!vuln.fixAvailable;
    const autoFixable = fixable && !isSensitiveDep(pkgName) && severity !== 'critical';

    const cveIds = (vuln.via || [])
      .filter(v => typeof v === 'object' && v.url)
      .map(v => v.source || null).filter(Boolean);

    let cvssScore = null;
    if (cveIds.length > 0 && process.env.NIST_NVD_API_KEY) {
      cvssScore = await lookupCvssScore(cveIds[0]).catch(() => null);
    }

    const issue = {
      scanId, repoFullName, issueType: 'vulnerability', severity,
      title: `${pkgName}: ${vuln.name || severity} vulnerability`,
      description: (vuln.via || []).filter(v => typeof v === 'object')
        .map(v => v.title || '').join('; ').substring(0, 500),
      cveId: cveIds[0] || null, cvssScore,
      fixAvailable: fixable,
      fixDescription: fixable
        ? `npm audit fix${vuln.fixAvailable === true ? '' : ' --force'}`
        : 'No automatic fix available',
      autoFixable,
    };

    await insertSecurityIssue(issue).catch(() => {});
    issues.push(issue);
  }

  logger.info({
    repoFullName, total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
  }, 'Dependency scan complete');

  return issues;
}

async function lookupCvssScore(cveId) {
  if (!cveId || !cveId.startsWith('CVE-')) return null;
  const r = await axios.get(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`,
    {
      headers: process.env.NIST_NVD_API_KEY
        ? { apiKey: process.env.NIST_NVD_API_KEY } : {},
      timeout: 8000,
    }
  );
  const metrics = r.data?.vulnerabilities?.[0]?.cve?.metrics;
  const cvssV3  = metrics?.cvssMetricV31?.[0] || metrics?.cvssMetricV30?.[0];
  return cvssV3?.cvssData?.baseScore || null;
}

module.exports = { scanDependencies };
