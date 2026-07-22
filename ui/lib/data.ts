import type { Agent } from "./types";

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

// REPOS and FEED (fabricated repo/activity data) were removed — they were
// only ever used as a silent fallback when the backend was unreachable,
// which is indistinguishable from real data and can paper over a genuine
// outage. Show an honest error/empty state in the UI instead of mock data.

export function healthColor(score: number) {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}
