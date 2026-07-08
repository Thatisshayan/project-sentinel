# Agents

Project Sentinel uses a pool of AI agents to perform code audits, fixes, and portfolio management. Each agent corresponds to a specific AI provider and model.

## Agent pool

| Agent ID | Provider | Model | Role |
|----------|----------|-------|------|
| `nvidia` | NVIDIA NIM | `meta/llama-3.1-70b-instruct` | Primary auditor + builder |
| `gemini` | Google Gemini | `gemini-2.0-flash` | Sprint planning + reports |
| `qwen_max` | DashScope (Alibaba) | `qwen-max` | Sprint planning fallback |
| `qwen_coder` | NVIDIA NIM | `meta/llama-3.1-70b-instruct` | Code-focused builds (primary builder) |
| `qwen_coder_dash` | DashScope | `qwen2.5-coder-32b-instruct` | Code-focused builds (DashScope fallback) |
| `deepseek` | DeepSeek | `deepseek-chat` | Strategy (brain) |
| `llama_fast` | NVIDIA NIM | `meta/llama-3.1-8b-instruct` | Fast audit tasks |

> **NVIDIA NIM model note:** this project's NIM key is only entitled to a
> narrow set of models. Confirmed working: `meta/llama-3.1-70b-instruct`,
> `meta/llama-3.1-8b-instruct`, `mistralai/mistral-nemotron`. Confirmed
> **not** available on this key (HTTP 404, or hangs until timeout):
> `nvidia/llama-3.1-nemotron-70b-instruct`, `meta/llama-3.3-70b-instruct`,
> `mistralai/codestral-22b-instruct-v0.1`, `deepseek-ai/deepseek-coder-6.7b-instruct`,
> `ibm/granite-*-code-instruct`, `bigcode/starcoder2-15b`, and
> `qwen/qwen2.5-coder-32b-instruct` (EOL'd by NVIDIA 2026-05-12, HTTP 410).
> Before changing any NIM model default, verify with a direct curl to
> `https://integrate.api.nvidia.com/v1/chat/completions` first — a model
> being in NIM's public catalog does not mean this key can call it. Also
> avoid Nemotron reasoning models with Aider: they return `content: null`
> and put output in `reasoning_content`/`<think>` blocks instead, which
> breaks both Aider's diff parsing and this codebase's `message.content`
> parsing (`ceoReport.js`, `sentinelBrain.js`, `sprintPlanner.js`,
> `telegramAI.js`, `claudeCodeAudit.js`).

## Configuration

Each agent is activated by setting its provider's API key in Railway (or your `.env` file):

| Key | Activates |
|-----|-----------|
| `NVIDIA_API_KEY` | nvidia, llama_fast, qwen_coder (via NIM) |
| `GEMINI_API_KEY` | gemini |
| `DASHSCOPE_API_KEY` | qwen_max, qwen_coder_dash, qwen_turbo |
| `DEEPSEEK_API_KEY` | deepseek |

If multiple providers are configured, Sentinel chooses the best fit for each task based on `AIDER_MODEL` and capacity settings.

## Agent bots (optional)

Each agent can send Telegram messages under its own bot identity. Configure with `BOT_TOKEN_<AGENTNAME>` (e.g., `BOT_TOKEN_NVIDIA`). Without these, all messages come from the primary bot. Use `/sentinel bots` to see configuration status.

## Priority chain for each operation

| Operation | Primary | Fallbacks |
|-----------|---------|-----------|
| Audit | NVIDIA NIM (`mistralai/mistral-nemotron`) | Claude Code (aider) |
| Sprint planning | NVIDIA NIM (`mistralai/mistral-nemotron`) | Gemini → DashScope → DeepSeek |
| Strategic brain | NVIDIA NIM (`mistralai/mistral-nemotron`) | DeepSeek |
| Build repair (aider) | NVIDIA NIM (`meta/llama-3.1-70b-instruct`, via `AIDER_MODEL`) | Gemini → DashScope → DeepSeek (see `builderRouter.js` `FALLBACK_CHAIN`) |

## Status monitoring

- `/sentinel agents` — current status of all registered agents
- `/sentinel what` — agents currently working on a task
- `/sentinel leaderboard` — weekly performance ranking
- Agent errors surface in the UI agents panel and via Telegram startup alerts
