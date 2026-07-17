const HIGH_RISK_PATTERNS = [
  '.env', 'secret', 'credential', 'token', 'auth',
  'payment', 'billing', 'stripe', 'checkout',
  'migration', 'schema.prisma', 'schema.sql',
  'dockerfile', 'docker-compose', 'railway.toml',
  'vercel.json', 'netlify.toml', '.github/workflows',
];

const MARKETING_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.svg',
  '.gif', '.fig', '.psd', '.ai', '.ico', '.mp4', '.mov',
]);

const MARKETING_PATH_SEGMENTS = [
  '/assets', '/images', '/public', '/marketing',
  '/brand', '/design', '/static', '/media',
];

function assessRisk(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return 'Low';
  }

  const allMarketing = changedFiles.every(file => {
    const lower = file.toLowerCase();
    const dotIndex = lower.lastIndexOf('.');
    const ext = dotIndex !== -1 ? lower.slice(dotIndex) : '';
    const isMarketingExt = MARKETING_EXTENSIONS.has(ext);
    const isMarketingPath = MARKETING_PATH_SEGMENTS.some(seg =>
      ('/' + lower).includes(seg)
    );
    return isMarketingExt || isMarketingPath;
  });

  if (allMarketing) return 'Low';

  const hasHighRisk = changedFiles.some(file => {
    const lower = file.toLowerCase();
    return HIGH_RISK_PATTERNS.some(pattern =>
      lower.includes(pattern.toLowerCase())
    );
  });

  if (hasHighRisk) return 'High';

  return 'Medium';
}

function isMarketingOnly(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) return false;

  return changedFiles.every(file => {
    const lower = file.toLowerCase();
    const dotIndex = lower.lastIndexOf('.');
    const ext = dotIndex !== -1 ? lower.slice(dotIndex) : '';
    const isMarketingExt = MARKETING_EXTENSIONS.has(ext);
    const isMarketingPath = MARKETING_PATH_SEGMENTS.some(seg =>
      ('/' + lower).includes(seg)
    );
    return isMarketingExt || isMarketingPath;
  });
}

const HIGH_RISK_LOG_SIGNALS = [
  'secret', 'token', 'credential', 'api_key', 'api key',
  'permission denied', 'unauthorized', 'forbidden',
  'billing', 'payment', 'subscription',
  'migration failed', 'database error', 'schema',
  'out of memory', 'disk full',
  'quota exceeded', 'rate limit exceeded',
];

const HIGH_RISK_BUILD_SIGNALS = [
  'deploy failed',
  'environment variable',
  'env var',
  'missing required',
];

function assessLogRisk(failureLogs, buildProvider) {
  if (!failureLogs) return { isHighRisk: false, reason: null };

  const logsLower = failureLogs.toLowerCase();

  for (const signal of HIGH_RISK_LOG_SIGNALS) {
    if (logsLower.includes(signal)) {
      return {
        isHighRisk: true,
        reason: `Failure logs contain high-risk signal: "${signal}"`,
      };
    }
  }

  // Provider-specific signals
  if (buildProvider === 'railway' || buildProvider === 'vercel') {
    const hasDeployFailed = HIGH_RISK_BUILD_SIGNALS.some(s => logsLower.includes(s));
    const hasCodeError    = logsLower.includes('error:') || logsLower.includes('syntaxerror');

    if (hasDeployFailed && !hasCodeError) {
      return {
        isHighRisk: true,
        reason:     `${buildProvider} deploy failed without a clear code error — likely env/config issue`,
      };
    }
  }

  return { isHighRisk: false, reason: null };
}

function sanitizeLogs(logs) {
  if (!logs) return '';

  const SENSITIVE_PATTERNS = [
    /token[=:\s]+\S+/gi,
    /secret[=:\s]+\S+/gi,
    /key[=:\s]+[A-Za-z0-9_-]{10,}/gi,
    /password[=:\s]+\S+/gi,
    /authorization[=:\s]+\S+/gi,
    /bearer\s+\S+/gi,
  ];

  let sanitized = logs;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate to first 200 lines
  return sanitized.split('\n').slice(0, 200).join('\n');
}

module.exports = {
  // Keep existing exports
  assessRisk,
  isMarketingOnly,
  // Add new exports
  assessLogRisk,
  sanitizeLogs,
};
