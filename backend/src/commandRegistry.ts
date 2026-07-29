// Phase 0 of docs/2026-07-22-slack-agent-roster-plan.md — verb-first command
// dispatch. Maps the new no-prefix command syntax (e.g. "audit <repo>",
// "sprint status", "security scan <repo>") onto the existing subcommand
// handlers unchanged, so this is purely a new front door, not a rewrite of
// command behavior. Legacy "/sentinel <subcommand>" text still works too —
// callers should try the legacy path first (see telegramCommands.ts) and
// fall back to dispatchCommand for everything else.
//
// Two commands from the plan's rename table don't tokenize as a clean
// verb-first prefix in their documented form (arg falls in the middle:
// "execute <repo> force", "skip <repo> batch <n>"). Implemented here with
// the modifier moved before the arg instead ("execute force <repo>",
// "skip batch <repo> <n>") — a deliberate, documented deviation for
// parseability; the doc's canonical list should be corrected to match.

import type { handleAgentsCmd } from './commands/agents';
import type { handleRepoOpsCmd } from './commands/repoOps';
import type { handleReportsCmd } from './commands/reports';
import type { handleSprintCmd } from './commands/sprint';
import type { handleRoundtableCmd } from './commands/roundtable';

type CommandHandler = (
  subcommand: string,
  parts: string[],
  chatId: string | null,
  topicId: number | null
) => Promise<boolean>;

interface AliasEntry {
  words: string[];     // lowercase verb-first tokens to match, longest-match-first
  legacy: string;       // subcommand string the existing handler switch expects
  handler: CommandHandler;
}

function buildAliases(handlers: {
  agents: typeof handleAgentsCmd;
  repoOps: typeof handleRepoOpsCmd;
  reports: typeof handleReportsCmd;
  sprint: typeof handleSprintCmd;
  roundtable: typeof handleRoundtableCmd;
}): AliasEntry[] {
  const { agents, repoOps, reports, sprint, roundtable } = handlers;
  return [
    // Reports
    { words: ['report'],              legacy: 'report',           handler: reports },
    { words: ['weekly'],              legacy: 'weekly',           handler: reports },
    { words: ['ceo'],                 legacy: 'ceo',              handler: reports },
    { words: ['costs'],               legacy: 'costs',            handler: reports },
    { words: ['health'],              legacy: 'health',           handler: repoOps },
    { words: ['velocity'],            legacy: 'velocity',         handler: reports },
    { words: ['patterns'],            legacy: 'patterns',         handler: reports },
    { words: ['business'],            legacy: 'business',         handler: reports },
    { words: ['impact'],              legacy: 'impact',           handler: reports },
    { words: ['roi'],                 legacy: 'roi',              handler: reports },

    // Agents
    { words: ['agents'],              legacy: 'agents',           handler: agents },
    { words: ['active'],              legacy: 'what',             handler: repoOps },
    { words: ['standup'],             legacy: 'standup',          handler: agents },
    { words: ['leaderboard'],         legacy: 'leaderboard',      handler: agents },
    { words: ['bots', 'test'],        legacy: 'test-bots',        handler: agents },
    { words: ['bots', 'setup'],       legacy: 'setup-bots',       handler: agents },
    { words: ['bots'],                legacy: 'bots',             handler: agents },
    { words: ['memory'],              legacy: 'memory',           handler: agents },
    { words: ['assign'],              legacy: 'assign',           handler: agents },
    { words: ['viktor', 'log'],       legacy: 'viktor-log',       handler: agents },
    { words: ['viktor', 'rules'],     legacy: 'viktor-rules',     handler: agents },
    { words: ['roundtable'],          legacy: 'roundtable',       handler: roundtable }, // Phase 7

    // Repos
    { words: ['audit'],               legacy: 'audit',            handler: repoOps },
    { words: ['tasks'],               legacy: 'tasks',            handler: repoOps },
    { words: ['execute', 'force'],    legacy: 'force-execute',    handler: repoOps }, // "execute force <repo>" — see file header
    { words: ['execute'],             legacy: 'execute',          handler: repoOps },
    { words: ['stop'],                legacy: 'stop',             handler: repoOps },
    { words: ['skip', 'batch'],       legacy: 'skip-batch',       handler: repoOps }, // "skip batch <repo> <n>" — see file header
    { words: ['skip'],                legacy: 'skip',             handler: repoOps },
    { words: ['lock'],                legacy: 'lock',             handler: repoOps },
    { words: ['unlock'],              legacy: 'unlock',           handler: repoOps },
    { words: ['locked'],              legacy: 'locked',           handler: repoOps },
    { words: ['repos', 'scan'],       legacy: 'repos',            handler: repoOps }, // parts[2] stays 'scan', matches existing switch
    { words: ['repos'],               legacy: 'repos',            handler: repoOps },
    { words: ['repo'],                legacy: 'repo',             handler: repoOps },
    { words: ['dashboard'],           legacy: 'dashboard',        handler: repoOps },
    { words: ['remember'],            legacy: 'remember',         handler: repoOps }, // D-027 item 6: project memory
    { words: ['forget'],              legacy: 'forget',           handler: repoOps },
    { words: ['project', 'memory'],   legacy: 'project-memory',   handler: repoOps }, // two-word: avoids colliding with the existing single-word 'memory' (conversation history, commands/agents.ts)
    { words: ['reset', 'failed'],     legacy: 'reset-failed',     handler: repoOps },
    { words: ['webhook', 'status'],   legacy: 'webhook-status',   handler: repoOps },

    // Sprint
    { words: ['sprint', 'propose'],   legacy: 'propose-sprint',   handler: sprint },
    { words: ['sprint', 'approve'],   legacy: 'approve-sprint',   handler: sprint },
    { words: ['sprint', 'run'],       legacy: 'run-sprint',       handler: sprint },
    { words: ['sprint', 'status'],    legacy: 'sprint-status',    handler: sprint },
    { words: ['sprint', 'skip'],      legacy: 'skip-sprint',      handler: sprint },
    { words: ['sprint', 'pause'],     legacy: 'pause-sprint',     handler: sprint },
    { words: ['sprint', 'resume'],    legacy: 'resume-sprint',    handler: sprint },
    { words: ['approvals'],           legacy: 'approve',          handler: repoOps },

    // Security
    { words: ['security', 'scan'],    legacy: 'security-scan',    handler: repoOps },
    { words: ['security', 'patch'],   legacy: 'security-patch',   handler: repoOps },
    { words: ['security', 'approve'], legacy: 'security-approve', handler: repoOps },
    { words: ['security'],            legacy: 'security',         handler: repoOps },

    // System
    { words: ['pause'],               legacy: 'pause',            handler: repoOps },
    { words: ['resume'],              legacy: 'resume',           handler: repoOps },
    { words: ['self', 'audit'],       legacy: 'self-audit',       handler: agents },
    { words: ['self', 'approve'],     legacy: 'self-approve',     handler: agents },
    { words: ['status'],              legacy: 'status',           handler: repoOps },
    { words: ['builds'],              legacy: 'builds',           handler: repoOps },
    { words: ['performance'],         legacy: 'performance',      handler: reports },
    { words: ['prompts'],             legacy: 'prompts',          handler: reports },
    { words: ['brain'],               legacy: 'brain',            handler: repoOps },
    { words: ['builder', 'check'],    legacy: 'check-builder',    handler: repoOps },
    { words: ['metrics', 'sync'],     legacy: 'sync-metrics',     handler: repoOps },
    { words: ['menu'],                legacy: 'menu',             handler: repoOps },
    { words: ['help'],                legacy: 'help',             handler: repoOps },
    { words: ['retry'],               legacy: 'retry',            handler: repoOps },
  ];
}

let cachedAliases: AliasEntry[] | null = null;

function getAliases(): AliasEntry[] {
  if (cachedAliases) return cachedAliases;
  const { handleAgentsCmd: agents } = require('./commands/agents');
  const { handleRepoOpsCmd: repoOps } = require('./commands/repoOps');
  const { handleReportsCmd: reports } = require('./commands/reports');
  const { handleSprintCmd: sprint } = require('./commands/sprint');
  const { handleRoundtableCmd: roundtable } = require('./commands/roundtable');
  cachedAliases = buildAliases({ agents, repoOps, reports, sprint, roundtable })
    .sort((a, b) => b.words.length - a.words.length); // longest-prefix-first match
  return cachedAliases;
}

/**
 * Resolve verb-first command text (no "/sentinel" prefix) against the
 * canonical alias table and dispatch into the existing subcommand handlers.
 * Returns false if no alias matches (caller should fall back to AI-routed
 * free text, per the plan's mention-default design).
 */
async function dispatchCommand(
  text: string,
  chatId: string | null,
  topicId: number | null
): Promise<boolean> {
  const rawTokens = text.trim().split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return false;
  const lowerTokens = rawTokens.map(t => t.toLowerCase());

  for (const entry of getAliases()) {
    const isMatch = entry.words.every((word, i) => lowerTokens[i] === word);
    if (!isMatch) continue;
    const remainingArgs = rawTokens.slice(entry.words.length);
    const parts = ['sentinel', entry.legacy, ...remainingArgs];
    return entry.handler(entry.legacy, parts, chatId, topicId);
  }
  return false;
}

export = { dispatchCommand };
