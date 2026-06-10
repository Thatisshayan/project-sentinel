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
      shiporex: 21,
      mint: 22,
      'project-sentinel': 29,
    },
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  },
  vercel: {
    token: process.env.VERCEL_TOKEN,
  },
  railway: {
    token: process.env.RAILWAY_TOKEN,
    apiUrl: 'https://backboard.railway.com/graphql/v2',
    projectId: process.env.RAILWAY_PROJECT_ID || '2b2211cb-5177-4568-aefb-3d5fb0dc8cbc',
  },
  debugger: {
    maxRetries: 5,
    agentOrder: ['OpenCode', 'OpenHands'],
    openHandsUrl: process.env.OPENHANDS_URL || '',
  },
};
