"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const execAsync_1 = require("./utils/execAsync");
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const securityDb_1 = require("./securityDb");
const SENSITIVE_PATHS = [
    'auth', 'middleware', 'stripe', 'paypal', 'payout', 'billing',
    'users', 'firebaseAdmin', 'firebase-admin', 'jwt', 'token',
    '.env', 'railway.toml', 'firebase.json',
];
function isSensitiveDep(depName) {
    return SENSITIVE_PATHS.some(p => depName.toLowerCase().includes(p));
}
async function scanDependencies(repoPath, repoFullName, scanId) {
    const issues = [];
    let rawAudit = null;
    try {
        const { stdout } = await (0, execAsync_1.execAsync)('npm audit --json', {
            cwd: repoPath, timeout: 60000,
        });
        rawAudit = JSON.parse(stdout);
    }
    catch (err) {
        try {
            rawAudit = JSON.parse(err.stdout?.toString() || '{}');
        }
        catch {
            logger_1.default.warn({ repoFullName }, 'npm audit parse failed');
            return [];
        }
    }
    const vulns = rawAudit.vulnerabilities || {};
    for (const [pkgName, vuln] of Object.entries(vulns)) {
        const severity = vuln.severity || 'low';
        const fixable = !!vuln.fixAvailable;
        const autoFixable = fixable && !isSensitiveDep(pkgName) && severity !== 'critical';
        // npm audit's `via` entries don't carry CVE strings — `source` is a numeric
        // GHSA advisory id and `url` points at the GitHub advisory page. Extract the
        // GHSA id from the URL (the only thing that looks like a real identifier),
        // and fall back to the CVSS score npm audit already provides per-advisory.
        const advisories = (vuln.via || []).filter((v) => typeof v === 'object' && v.url);
        const ghsaIds = advisories
            .map((v) => v.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] || null)
            .filter(Boolean);
        const npmCvssScore = advisories.find((v) => typeof v.cvss?.score === 'number')?.cvss?.score ?? null;
        let cvssScore = null;
        const firstCveLike = (vuln.via || [])
            .filter((v) => typeof v === 'object')
            .map((v) => v.url?.match(/CVE-\d{4}-\d+/i)?.[0] || null)
            .find(Boolean) || null;
        if (firstCveLike && process.env['NIST_NVD_API_KEY']) {
            cvssScore = await lookupCvssScore(firstCveLike).catch(() => null);
        }
        if (cvssScore === null)
            cvssScore = npmCvssScore;
        const issue = {
            scanId, repoFullName, issueType: 'vulnerability', severity,
            title: `${pkgName}: ${vuln.name || severity} vulnerability`,
            description: (vuln.via || []).filter((v) => typeof v === 'object')
                .map((v) => v.title || '').join('; ').substring(0, 500),
            cveId: firstCveLike || ghsaIds[0] || null, cvssScore: cvssScore ?? undefined,
            fixAvailable: fixable,
            fixDescription: fixable
                ? `npm audit fix${vuln.fixAvailable === true ? '' : ' --force'}`
                : 'No automatic fix available',
            autoFixable,
        };
        await (0, safeFire_1.safeFire)((0, securityDb_1.insertSecurityIssue)(issue), { label: 'dependencyScanner' });
        issues.push(issue);
    }
    logger_1.default.info({
        repoFullName, total: issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
    }, 'Dependency scan complete');
    return issues;
}
async function lookupCvssScore(cveId) {
    if (!cveId || !cveId.startsWith('CVE-'))
        return null;
    const r = await axios_1.default.get(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`, {
        headers: process.env['NIST_NVD_API_KEY']
            ? { apiKey: process.env['NIST_NVD_API_KEY'] } : {},
        timeout: 8000,
    });
    const metrics = r.data?.vulnerabilities?.[0]?.cve?.metrics;
    const cvssV3 = metrics?.cvssMetricV31?.[0] || metrics?.cvssMetricV30?.[0];
    return cvssV3?.cvssData?.baseScore || null;
}
module.exports = { scanDependencies };
//# sourceMappingURL=dependencyScanner.js.map