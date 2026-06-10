export const config = {
  port: parseInt(process.env.PORT || '3000'),
  notion: {
    apiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DATABASE_ID || 'fdeacf62-61e2-4b07-8e16-c19e8df9ffbe',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || '-1003524913240',
    repoTopics: {
      costpilot: 18,
      tapcash: 19,
      alphonsoecosystem: 20,
      shiporex: 21,
      mint: 22,
      sessionguard: 40,
      'project-aegis-launch-site': 42,
      obsidianstudio: 43,
      obsidianmedia: 44,
      'alphonso-marketing-site': 46,
      alphonsowebsite: 47,
      'ehsan-salimi-portfolio': 48,
      'project-sentinel': 29,
    },
  },
  github: {
    token: process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  },
  vercel: {
    token: process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN,
  },
  railway: {
    token: process.env.RAILWAY_TOKEN || process.env['RAILWAY_API-TOKEN'],
    apiToken: process.env['RAILWAY_API-TOKEN'] || process.env.RAILWAY_TOKEN,
    apiUrl: 'https://backboard.railway.com/graphql/v2',
    projectId: process.env.RAILWAY_PROJECT_ID || '2b2211cb-5177-4568-aefb-3d5fb0dc8cbc',
  },
  debugger: {
    maxRetries: 5,
    agentOrder: ['OpenCode', 'OpenHands'],
    openHandsUrl: process.env.OPENHANDS_URL || '',
    openHandsUsername: process.env.OPENHANDS_USERNAME || '',
    openHandsPassword: process.env.OPENHANDS_PASSWORD || '',
    openCodeApiKey: process.env.OPENCODE_API_KEY || '',
  },
};
