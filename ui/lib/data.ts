import type { Agent, Repo, FeedEntry } from "./types";

export const AGENTS: Agent[] = [
  { id:"nem", name:"Nemotron",   model:"nvidia/nemotron-4-340b",   provider:"NVIDIA",  color:"#6366F1", status:"working", task:"Refactor auth middleware → JWT RS256",  repo:"sentinel-core",  elapsed:847,  done:34, prs:9,  fails:1 },
  { id:"qwc", name:"Qwen Coder", model:"qwen/qwen2.5-coder-32b",  provider:"Alibaba", color:"#F59E0B", status:"working", task:"Add pagination to /users endpoint",      repo:"data-ingestion", elapsed:312,  done:22, prs:6,  fails:2 },
  { id:"gem", name:"Gemini",     model:"google/gemini-2.0-flash",  provider:"Google",  color:"#22C55E", status:"idle",    task:null,                                     repo:null,             elapsed:0,    done:18, prs:5,  fails:0 },
  { id:"lla", name:"Llama",      model:"meta/llama-3.3-70b",       provider:"Meta",    color:"#3B82F6", status:"working", task:"Fix CORS headers on preflight",           repo:"api-gateway",    elapsed:1204, done:15, prs:4,  fails:1 },
  { id:"dsk", name:"DeepSeek",   model:"deepseek/deepseek-r1",     provider:"DeepSeek",color:"#8B5CF6", status:"failed",  task:"Optimize N+1 DB queries",                repo:"ml-pipeline",    elapsed:0,    done:9,  prs:2,  fails:5 },
  { id:"qwm", name:"Qwen Max",   model:"qwen/qwen-max",            provider:"Alibaba", color:"#EC4899", status:"idle",    task:null,                                     repo:null,             elapsed:0,    done:27, prs:8,  fails:0 },
  { id:"qwt", name:"Qwen Turbo", model:"qwen/qwen-turbo",          provider:"Alibaba", color:"#14B8A6", status:"working", task:"CVE dependency scan",                    repo:"auth-service",   elapsed:523,  done:19, prs:6,  fails:1 },
  { id:"qwd", name:"Qwen Dash",  model:"qwen/qwen-plus",           provider:"Alibaba", color:"#F97316", status:"idle",    task:null,                                     repo:null,             elapsed:0,    done:12, prs:3,  fails:0 },
];

export const REPOS: Repo[] = [
  { name:"sentinel-core",   health:94, security:88, agent:"Nemotron",   commit:"2h ago",  build:"pass",    priority:"P0", tasks:8  },
  { name:"api-gateway",     health:78, security:72, agent:"Llama",      commit:"4h ago",  build:"pass",    priority:"P1", tasks:5  },
  { name:"ml-pipeline",     health:61, security:44, agent:null,          commit:"8h ago",  build:"fail",    priority:"P1", tasks:12 },
  { name:"auth-service",    health:88, security:91, agent:"Qwen Turbo", commit:"1h ago",  build:"pass",    priority:"P0", tasks:3  },
  { name:"data-ingestion",  health:45, security:63, agent:"Qwen Coder", commit:"1d ago",  build:"pending", priority:"P2", tasks:9  },
  { name:"dashboard-ui",    health:82, security:79, agent:null,          commit:"30m ago", build:"pass",    priority:"P1", tasks:2  },
  { name:"billing-service", health:71, security:85, agent:null,          commit:"3h ago",  build:"pass",    priority:"P0", tasks:6  },
  { name:"worker-queue",    health:55, security:57, agent:null,          commit:"6h ago",  build:"fail",    priority:"P2", tasks:7  },
];

export const FEED: FeedEntry[] = [
  { agent:"Nemotron",   color:"#6366F1", repo:"sentinel-core",  msg:"Opened PR #142: refactor auth middleware → JWT RS256",   time:"2m"  },
  { agent:"Llama",      color:"#3B82F6", repo:"api-gateway",    msg:"Build passed · fix/cors-headers · 42/42 tests green",   time:"5m"  },
  { agent:"Qwen Coder", color:"#F59E0B", repo:"data-ingestion", msg:"Generated 6 tasks after repo audit scan completed",      time:"9m"  },
  { agent:"Qwen Turbo", color:"#14B8A6", repo:"auth-service",   msg:"Found 3 medium CVEs in lodash, express-validator",      time:"14m" },
  { agent:"Gemini",     color:"#22C55E", repo:"dashboard-ui",   msg:"Sprint proposal ready — 24 tasks · est. $8.20",         time:"20m" },
  { agent:"Nemotron",   color:"#6366F1", repo:"sentinel-core",  msg:"Completed: rate limiting on /api/v2 · 2m 14s build",   time:"33m" },
  { agent:"DeepSeek",   color:"#8B5CF6", repo:"ml-pipeline",    msg:"FAILED: circular import in /lib/db.ts — needs review",  time:"47m" },
  { agent:"Llama",      color:"#3B82F6", repo:"api-gateway",    msg:"Merged PR #139: update OpenAPI spec for /users",        time:"1h"  },
];

export function healthColor(score: number) {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}
