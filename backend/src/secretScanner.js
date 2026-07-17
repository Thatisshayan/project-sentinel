const logger = require('./logger');
const { insertSecurityIssue } = require('./securityDb');

const SECRET_PATTERNS = [
  { name: 'Firebase API Key',         regex: /AIza[0-9A-Za-z-_]{35}/g,              severity: 'critical' },
  { name: 'Firebase Service Account', regex: /"private_key":\s*"-----BEGIN/g,        severity: 'critical' },
  { name: 'Stripe Secret Key',        regex: /sk_(live|test)_[0-9a-zA-Z]{24,}/g,    severity: 'critical' },
  { name: 'Stripe Publishable Key',   regex: /pk_(live|test)_[0-9a-zA-Z]{24,}/g,    severity: 'high'     },
  { name: 'GitHub Token',             regex: /ghp_[0-9a-zA-Z]{36}/g,                severity: 'critical' },
  { name: 'GitHub OAuth Token',       regex: /gho_[0-9a-zA-Z]{36}/g,                severity: 'critical' },
  { name: 'NVIDIA API Key',           regex: /nvapi-[0-9a-zA-Z-_]{64,}/g,           severity: 'high'     },
  { name: 'AWS Access Key',           regex: /AKIA[0-9A-Z]{16}/g,                   severity: 'critical' },
  { name: 'Private Key Block',        regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g, severity: 'critical' },
  { name: 'Generic JWT',              regex: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, severity: 'medium' },
  { name: 'Password in Code',         regex: /password\s*[:=]\s*["'][^"']{8,}["']/gi, severity: 'medium' },
  { name: 'Secret in Code',           regex: /secret\s*[:=]\s*["'][^"']{8,}["']/gi,   severity: 'high'   },
];

const IGNORED_PATHS = [
  '.md', '.txt', 'test/', 'tests/', '__tests__/',
  'fixtures/', '.example', '.sample', 'node_modules/',
];

function shouldIgnorePath(p) {
  // Match path segments exactly, not substrings
  // e.g. 'test/' should match 'test/file.js' but not 'contest/file.js'
  const normalized = p.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return IGNORED_PATHS.some(ignored => {
    if (ignored.endsWith('/')) {
      // Directory prefix match
      return segments.some(seg => seg === ignored.slice(0, -1));
    }
    // File extension or exact name match
    return segments.some(seg => seg === ignored || seg.endsWith(ignored));
  });
}

function shannonEntropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / str.length;
    return sum + p * Math.log2(p);
  }, 0);
}

function detectHighEntropyStrings(line) {
  const matches = line.match(/["'][A-Za-z0-9+/=_-]{20,}["']/g) || [];
  return matches.map(m => m.slice(1, -1)).filter(s => shannonEntropy(s) > 4.5);
}

async function scanDiff(diffText, repoFullName, scanId, commitSha) {
  if (!diffText) return [];
  const issues = [];
  const lines  = diffText.split('\n');
  let currentFile = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('+++ b/')) { currentFile = line.replace('+++ b/', ''); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (shouldIgnorePath(currentFile)) continue;

    const content = line.slice(1);

    for (const pattern of SECRET_PATTERNS) {
      if (content.match(pattern.regex)) {
        const issue = {
          scanId, repoFullName, issueType: 'secret',
          severity: pattern.severity,
          title: `Potential ${pattern.name} detected`,
          description: `Found in ${currentFile} near line ${i}. Commit: ${commitSha?.substring(0, 7)}`,
          filePath: currentFile, lineNumber: i,
          fixAvailable: true,
          fixDescription: 'Remove the secret, rotate it immediately, use environment variables instead.',
          autoFixable: false,
        };
        await insertSecurityIssue(issue).catch(() => {});
        issues.push(issue);
      }
    }

    const highEntropy = detectHighEntropyStrings(content);
    for (const s of highEntropy) {
      const caught = issues.some(iss => iss.filePath === currentFile && iss.lineNumber === i);
      if (caught) continue;
      const issue = {
        scanId, repoFullName, issueType: 'secret', severity: 'medium',
        title: 'High-entropy string — possible secret',
        description: `Entropy ${shannonEntropy(s).toFixed(2)} in ${currentFile}. May be a token or key.`,
        filePath: currentFile, lineNumber: i,
        fixAvailable: false, autoFixable: false,
      };
      await insertSecurityIssue(issue).catch(() => {});
      issues.push(issue);
    }
  }

  logger.info({ repoFullName, secrets: issues.length }, 'Secret scan complete');
  return issues;
}

module.exports = { scanDiff };
