import { safeFire, fireAndForget } from './utils/safeFire';
import { execAsync } from './utils/execAsync';
import axios from 'axios';
import logger from './logger';
import { insertSecurityIssue } from './securityDb';

const SENSITIVE_PATHS: string[] = [
  'auth','middleware','stripe','paypal','payout','billing',
  'users','firebaseAdmin','firebase-admin','jwt','token',
  '.env','railway.toml','firebase.json',
];

interface AuditAdvisory {
  title?: string;
  url?: string;
  cvss?: { score?: number };
  [key: string]: unknown;
}

interface AuditVuln {
  severity?: string;
  fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean };
  name?: string;
  via?: (string | AuditAdvisory)[];
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, AuditVuln>;
}

interface DependencyIssue {
  scanId: number;
  repoFullName: string;
  issueType: string;
  severity: string;
  title: string;
  description: string;
  cveId?: string;
  cvssScore?: number;
  fixAvailable: boolean;
  fixDescription: string;
  autoFixable: boolean;
}

function isSensitiveDep(depName: string): boolean {
  return SENSITIVE_PATHS.some(p => depName.toLowerCase().includes(p));
}

async function scanDependencies(repoPath: string, repoFullName: string, scanId: number): Promise<DependencyIssue[]> {
  const issues: DependencyIssue[] = [];
  let rawAudit: NpmAuditReport = {};

  try {
    const { stdout } = await execAsync('npm audit --json', {
      cwd: repoPath, timeout: 60000,
    });
    rawAudit = JSON.parse(stdout);
  } catch (err) {
    try { rawAudit = JSON.parse((err as { stdout?: { toString(): string } }).stdout?.toString() || '{}'); }
    catch { logger.warn({ repoFullName }, 'npm audit parse failed'); return []; }
  }

  const vulns: Record<string, AuditVuln> = rawAudit.vulnerabilities || {};

  for (const [pkgName, vuln] of Object.entries(vulns)) {
    const severity    = vuln.severity || 'low';
    const fixable     = !!vuln.fixAvailable;
    const autoFixable = fixable && !isSensitiveDep(pkgName) && severity !== 'critical';

    // npm audit's `via` entries don't carry CVE strings — `source` is a numeric
    // GHSA advisory id and `url` points at the GitHub advisory page. Extract the
    // GHSA id from the URL (the only thing that looks like a real identifier),
    // and fall back to the CVSS score npm audit already provides per-advisory.
    const advisories = (vuln.via || []).filter((v): v is AuditAdvisory => typeof v === 'object' && !!v.url);
    const ghsaIds = advisories
      .map((v) => v.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] || null)
      .filter((id): id is string => Boolean(id));
    const npmCvssScore = advisories.find((v) => typeof v.cvss?.score === 'number')?.cvss?.score ?? null;

    let cvssScore: number | null = null;
    const firstCveLike = (vuln.via || [])
      .filter((v): v is AuditAdvisory => typeof v === 'object')
      .map((v) => v.url?.match(/CVE-\d{4}-\d+/i)?.[0] || null)
      .find(Boolean) || null;

    if (firstCveLike && process.env['NIST_NVD_API_KEY']) {
      cvssScore = await lookupCvssScore(firstCveLike).catch(() => null);
    }
    if (cvssScore === null) cvssScore = npmCvssScore;

    const issue: DependencyIssue = {
      scanId, repoFullName, issueType: 'vulnerability', severity,
      title: `${pkgName}: ${vuln.name || severity} vulnerability`,
      description: (vuln.via || []).filter((v): v is AuditAdvisory => typeof v === 'object')
        .map((v) => v.title || '').join('; ').substring(0, 500),
      cveId: firstCveLike || ghsaIds[0] || undefined, cvssScore: cvssScore ?? undefined,
      fixAvailable: fixable,
      fixDescription: fixable
        ? `npm audit fix${vuln.fixAvailable === true ? '' : ' --force'}`
        : 'No automatic fix available',
      autoFixable,
    };

    await safeFire(insertSecurityIssue(issue), { label: 'dependencyScanner', retryable: true })
    issues.push(issue);
  }

  logger.info({
    repoFullName, total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
  }, 'Dependency scan complete');

  return issues;
}

async function lookupCvssScore(cveId: string): Promise<number | null> {
  if (!cveId || !cveId.startsWith('CVE-')) return null;
  const r = await axios.get(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`,
    {
      headers: process.env['NIST_NVD_API_KEY']
        ? { apiKey: process.env['NIST_NVD_API_KEY'] } : {},
      timeout: 8000,
    }
  );
  const metrics = r.data?.vulnerabilities?.[0]?.cve?.metrics;
  const cvssV3  = metrics?.cvssMetricV31?.[0] || metrics?.cvssMetricV30?.[0];
  return cvssV3?.cvssData?.baseScore || null;
}

export = { scanDependencies };
