export function generateSummary(commitMessage, changedFiles) {
  const files = changedFiles || [];
  const message = commitMessage || '';

  const groups = { code: [], config: [], docs: [], styles: [], other: [] };
  for (const f of files) {
    if (/\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(f)) groups.code.push(f);
    else if (/\.(json|ya?ml|env|toml)$/i.test(f)) groups.config.push(f);
    else if (/\.(md|txt|rst|wiki)$/i.test(f)) groups.docs.push(f);
    else if (/\.(css|scss|sass|less)$/i.test(f)) groups.styles.push(f);
    else groups.other.push(f);
  }

  const parts = [];
  if (groups.code.length) parts.push(`${groups.code.length} source file${groups.code.length > 1 ? 's' : ''}`);
  if (groups.config.length) parts.push(`${groups.config.length} config file${groups.config.length > 1 ? 's' : ''}`);
  if (groups.docs.length) parts.push(`${groups.docs.length} doc file${groups.docs.length > 1 ? 's' : ''}`);
  if (groups.styles.length) parts.push(`${groups.styles.length} style file${groups.styles.length > 1 ? 's' : ''}`);
  if (groups.other.length) parts.push(`${groups.other.length} other file${groups.other.length > 1 ? 's' : ''}`);

  let summary = message.split('\n')[0];
  if (parts.length) summary += ` (${parts.join(', ')})`;

  if (files.length > 0 && files.length <= 5) {
    summary += `\nFiles: ${files.join(', ')}`;
  }

  return summary;
}
