const HIGH_RISK_PATTERNS = [
  /\.env/i,
  /secret/i,
  /auth/i,
  /password/i,
  /token/i,
  /apikey/i,
  /database/i,
  /migration/i,
  /payment/i,
  /billing/i,
  /stripe/i,
  /wallet/i,
  /contract/i,
];

const MEDIUM_RISK_PATTERNS = [
  /package(-lock)?\.json/i,
  /yarn\.lock/i,
  /pnpm-lock/i,
  /docker/i,
  /config/i,
  /\.json$/i,
  /\.yaml$/i,
  /\.yml$/i,
];

export function computeRiskLevel(changedFiles, commitMessage) {
  const allFiles = (changedFiles || []).join(' ');
  const message = commitMessage || '';

  const highHit = HIGH_RISK_PATTERNS.some(p => p.test(allFiles) || p.test(message));
  if (highHit) return 'High';

  const mediumHit = MEDIUM_RISK_PATTERNS.some(p => p.test(allFiles) || p.test(message));
  if (mediumHit) return 'Medium';

  return 'Low';
}

export function isHighRiskChange(changedFiles, commitMessage) {
  const allFiles = (changedFiles || []).join(' ');
  const message = commitMessage || '';
  return HIGH_RISK_PATTERNS.some(p => p.test(allFiles) || p.test(message));
}
