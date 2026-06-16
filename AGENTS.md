# Agents

Project Sentinel uses a pool of AI agents to perform code audits, fixes, and portfolio management. Each agent corresponds to a specific AI provider and model.

## Agent pool

| Agent ID | Provider | Model | Role |
|----------|----------|-------|------|
| `nvidia` | NVIDIA NIM | `nvidia/llama-3.1-nemotron-70b-instruct` | Primary auditor + builder |
| `gemini` | Google Gemini | `gemini-2.0-flash` | Sprint planning + reports |
| `qwen_max` | DashScope (Alibaba) | `qwen-max` | Sprint planning fallback |
| `qwen_coder` | DashScope | `qwen/qwen2.5-coder-32b-instruct` | Code-focused builds |
| `deepseek` | DeepSeek | `deepseek-chat` | Strategy (brain) |
| `llama_fast` | NVIDIA NIM | `meta/llama-3.3-70b-instruct` | Fast audit tasks |

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
| Audit | NVIDIA NIM | Claude Code (aider) |
| Sprint planning | NVIDIA NIM | Gemini → DashScope → DeepSeek |
| Strategic brain | NVIDIA NIM | DeepSeek |
| Code execution (builder) | Configured by `AIDER_MODEL` | — |

## Status monitoring

- `/sentinel agents` — current status of all registered agents
- `/sentinel what` — agents currently working on a task
- `/sentinel leaderboard` — weekly performance ranking
- Agent errors surface in the UI agents panel and via Telegram startup alerts
