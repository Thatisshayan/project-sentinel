import logger from './logger';
import axios from 'axios';

const BOT_TOKEN = (): string | undefined => process.env['TELEGRAM_BOT_TOKEN'];
const BASE_URL  = (): string => `https://api.telegram.org/bot${BOT_TOKEN()}`;

interface InlineButton {
  text: string;
  callback_data: string;
}

async function sendMenu(chatId: number | string | null, threadId: number | null, text: string, buttons: InlineButton[][]): Promise<void> {
  await axios.post(`${BASE_URL()}/sendMessage`, {
    chat_id:           chatId,
    text,
    message_thread_id: threadId || undefined,
    reply_markup: {
      inline_keyboard: buttons,
    },
  }).catch((err: any) => logger.warn({ err: err.message }, 'Menu send failed'));
}

async function showMainMenu(chatId: number | string | null, threadId: number | null): Promise<void> {
  await sendMenu(chatId, threadId, '🛡️ Sentinel — Quick Actions', [
    [
      { text: '📊 Report',     callback_data: 'menu:report'    },
      { text: '💰 Costs',      callback_data: 'menu:costs'     },
      { text: '🤖 Agents',     callback_data: 'menu:agents'    },
    ],
    [
      { text: '🏃 Sprint',     callback_data: 'menu:sprint'    },
      { text: '🛡️ Self-Audit', callback_data: 'menu:selfaudit' },
      { text: '🔒 Security',   callback_data: 'menu:security'  },
    ],
    [
      { text: '✅ Approvals',  callback_data: 'menu:approvals' },
      { text: '📋 Last 5',     callback_data: 'menu:last'      },
      { text: '❓ Help',       callback_data: 'menu:help'      },
    ],
  ]);
}

async function showRepoMenu(chatId: number | string | null, threadId: number | null, repoName: string): Promise<void> {
  await sendMenu(chatId, threadId, `📁 ${repoName} — Actions`, [
    [
      { text: '📊 Status',   callback_data: `repo:status:${repoName}`   },
      { text: '🔍 Audit',    callback_data: `repo:audit:${repoName}`    },
    ],
    [
      { text: '⚡ Execute',  callback_data: `repo:execute:${repoName}`  },
      { text: '🔒 Security', callback_data: `repo:security:${repoName}` },
    ],
    [
      { text: '⏹ Stop',     callback_data: `repo:stop:${repoName}`     },
      { text: '🔐 Lock',     callback_data: `repo:lock:${repoName}`     },
    ],
  ]);
}

interface PendingApprovals {
  sprint: boolean;
  selfAudit: boolean;
  security: string | null;
}

async function showApprovalsMenu(chatId: number | string | null, threadId: number | null, pending: PendingApprovals): Promise<void> {
  const buttons: InlineButton[][] = [];
  if (pending.sprint) buttons.push([
    { text: '✅ Approve Sprint', callback_data: 'approve:sprint'      },
    { text: '⏭ Skip Sprint',    callback_data: 'approve:skip-sprint' },
  ]);
  if (pending.selfAudit) buttons.push([
    { text: '✅ Self-Approve', callback_data: 'approve:self' },
  ]);
  if (pending.security) buttons.push([
    { text: `🔒 Security Approve ${pending.security}`, callback_data: `approve:security:${pending.security}` },
  ]);

  if (buttons.length === 0) {
    await sendMenu(chatId, threadId, '✅ No pending approvals.', []);
    return;
  }
  await sendMenu(chatId, threadId, '⏳ Pending Approvals', buttons);
}

async function showDidYouMean(chatId: number | string | null, threadId: number | null, suggestions: { label: string; action: string }[]): Promise<void> {
  const buttons: InlineButton[][] = suggestions.map((s) => [
    { text: s.label, callback_data: `dym:${s.action}` }
  ]);
  buttons.push([{ text: '❌ Never mind', callback_data: 'dym:cancel' }]);
  await sendMenu(chatId, threadId, '🤔 Did you mean...?', buttons);
}

export = { showMainMenu, showRepoMenu, showApprovalsMenu, showDidYouMean, sendMenu };
