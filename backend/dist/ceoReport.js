"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const axios_1 = __importDefault(require("axios"));
const telegramClient_1 = require("./telegramClient");
const portfolioAnalytics_1 = require("./portfolioAnalytics");
const velocityTracker_1 = require("./velocityTracker");
const securityDb_1 = require("./securityDb");
const businessDb_1 = require("./businessDb");
async function callAI(prompt) {
    if (process.env['NVIDIA_API_KEY']) {
        const res = await axios_1.default.post('https://integrate.api.nvidia.com/v1/chat/completions', {
            model: 'mistralai/mistral-nemotron',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
            temperature: 0.4,
        }, {
            headers: { Authorization: `Bearer ${process.env['NVIDIA_API_KEY']}`, 'Content-Type': 'application/json' },
            timeout: 60000,
        });
        return res.data.choices[0]?.message?.content || null;
    }
    if (process.env['GEMINI_API_KEY']) {
        const res = await axios_1.default.post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
            model: 'gemini-2.0-flash',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
        }, {
            headers: { Authorization: `Bearer ${process.env['GEMINI_API_KEY']}`, 'Content-Type': 'application/json' },
            timeout: 60000,
        });
        return res.data.choices[0]?.message?.content || null;
    }
    if (process.env['DASHSCOPE_API_KEY']) {
        const res = await axios_1.default.post(`${process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`, {
            model: 'qwen-max',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
        }, {
            headers: { Authorization: `Bearer ${process.env['DASHSCOPE_API_KEY']}`, 'Content-Type': 'application/json' },
            timeout: 60000,
        });
        return res.data.choices[0]?.message?.content || null;
    }
    if (process.env['DEEPSEEK_API_KEY']) {
        const res = await axios_1.default.post('https://api.deepseek.com/chat/completions', {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
        }, {
            headers: { Authorization: `Bearer ${process.env['DEEPSEEK_API_KEY']}`, 'Content-Type': 'application/json' },
            timeout: 60000,
        });
        return res.data.choices[0]?.message?.content || null;
    }
    return null;
}
async function generateCEOReport(topicId) {
    logger_1.default.info('Generating CEO weekly report');
    try {
        const [portfolioResult, velocityResult, securityResult, tapcashResult] = await Promise.allSettled([
            (0, portfolioAnalytics_1.getPortfolioSummary)(),
            (0, velocityTracker_1.getVelocityReport)(),
            (0, securityDb_1.getPortfolioSecuritySummary)(),
            (0, businessDb_1.getLatestMetrics)('tapcash'),
        ]);
        const p = portfolioResult.status === 'fulfilled' ? portfolioResult.value : null;
        const s = securityResult.status === 'fulfilled' ? securityResult.value : [];
        const avgHealth = p?.avgHealth || 'N/A';
        const healthy = p?.healthy?.length || 0;
        const broken = p?.broken?.length || 0;
        const avgSecurity = s.length > 0
            ? (s.reduce((sum, r) => sum + parseFloat(r.score || 0), 0) / s.length).toFixed(1)
            : 'N/A';
        const tapcashRows = tapcashResult.status === 'fulfilled' ? (tapcashResult.value || []) : [];
        const bizMap = Object.fromEntries(tapcashRows.map((r) => [r.metric_name, parseFloat(r.metric_value)]));
        const velocityText = velocityResult.status === 'fulfilled' ? String(velocityResult.value || '') : '';
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
        const dataSummary = [
            `Date: ${todayStr}`,
            `Portfolio health: ${avgHealth}/10 (${healthy} healthy, ${broken} broken)`,
            `Portfolio security: ${avgSecurity}/10`,
            bizMap.daily_active_users != null ? `TapCash DAU: ${bizMap.daily_active_users}` : '',
            bizMap.revenue_total != null ? `TapCash revenue: $${bizMap.revenue_total}` : '',
            bizMap.conversion_rate != null ? `TapCash conversion: ${bizMap.conversion_rate}%` : '',
            velocityText ? `Velocity: ${velocityText}` : '',
        ].filter(Boolean).join('\n');
        const prompt = `You are Sentinel, an autonomous DevOps AI writing a weekly CEO summary for Shayan, a solo founder in Toronto.

Here is the data from this week:
${dataSummary}

Write a SHORT, direct founder-style weekly update. 3 sections:
1. WHAT HAPPENED (3-4 bullet points — what Sentinel actually did this week)
2. THE NUMBERS (health, security, business metrics — just the key ones)
3. NEXT WEEK (what Sentinel is planning — 2-3 bullets)

Tone: confident, like a sharp technical co-founder. No fluff. No "I hope this helps."
Max 200 words. Start with "📊 Weekly Update —" and today's date (${todayStr}).`;
        const rawNote = await callAI(prompt).catch(() => null);
        const ceoNote = rawNote
            ? rawNote.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
            : null;
        const message = ceoNote || [
            `📊 Weekly Update — ${todayStr}`,
            ``,
            `Portfolio Health: ${avgHealth}/10  Security: ${avgSecurity}/10`,
            `Repos: ${healthy} healthy, ${broken} broken`,
            bizMap.daily_active_users != null ? `TapCash — DAU: ${bizMap.daily_active_users}` : '',
            bizMap.revenue_total != null ? `Revenue: $${bizMap.revenue_total}` : '',
            ``,
            `See /sentinel dashboard for full breakdown.`,
        ].filter(Boolean).join('\n');
        await (0, telegramClient_1.sendTelegramMessage)(message, null, topicId || null);
        logger_1.default.info('CEO report sent');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'CEO report failed');
    }
}
module.exports = { generateCEOReport };
//# sourceMappingURL=ceoReport.js.map