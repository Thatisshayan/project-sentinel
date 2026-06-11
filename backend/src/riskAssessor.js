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

module.exports = { assessRisk, isMarketingOnly };
