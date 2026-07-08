export type AgentStatus = "working" | "idle" | "failed";
export type BuildStatus = "pass" | "fail" | "pending";
export type Priority    = "P0" | "P1" | "P2";

export interface Agent {
  id:      string;
  name:    string;
  model:   string;
  provider: string;
  color:   string;
  status:  AgentStatus;
  task:    string | null;
  repo:    string | null;
  elapsed: number;
  done:    number;
  prs:     number;
  fails:   number;
}

export interface Repo {
  name:     string;
  health:   number;
  security: number;
  agent:    string | null;
  commit:   string;
  build:    BuildStatus;
  priority: Priority;
  tasks:    number;
}

export interface FeedEntry {
  agent: string;
  color: string;
  repo:  string;
  msg:   string;
  time:  string;
}

export type NavPage =
  | "home" | "repos" | "agents" | "agent-room"
  | "security" | "sprint" | "connectors" | "settings";
