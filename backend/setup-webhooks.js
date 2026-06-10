const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const repos = [
  'Thatisshayan/AlphonsoEcosystem',
  'Thatisshayan/Tapcash',
  'Thatisshayan/Costpilot',
  'Thatisshayan/shiporex',
  'Thatisshayan/Mint',
  'Thatisshayan/alphonso-marketing-site',
  'Thatisshayan/AlphonsoWebsite',
  'Thatisshayan/Ehsan-Salimi-Portfolio',
];

async function addWebhook(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/hooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: WEBHOOK_URL,
        content_type: 'json',
        insecure_ssl: '0',
      },
    }),
  });
  if (res.ok) {
    const data = await res.json();
    console.log(`✅ ${repo}: webhook created (id: ${data.id})`);
  } else {
    const err = await res.text();
    console.log(`❌ ${repo}: ${err}`);
  }
}

async function main() {
  if (!GITHUB_TOKEN || !WEBHOOK_URL) {
    console.error('Set GITHUB_TOKEN and WEBHOOK_URL env vars');
    process.exit(1);
  }
  for (const repo of repos) {
    await addWebhook(repo);
  }
}

main();
