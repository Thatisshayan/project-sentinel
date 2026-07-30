// Shape of a Claude Code / NVIDIA-fallback audit's parsed JSON output (see
// claudeCodeAudit.ts's parseAuditOutput and its prompt-embedded output
// schema for the source of truth). Standalone module because
// claudeCodeAudit.ts uses `export =`.

export interface AuditTask {
  taskNumber: number;
  priority: string;
  category: string;
  title: string;
  description: string;
  affectedFiles: string[];
  estimatedComplexity: string;
  safeToAutoExecute: boolean;
  safetyReason: string;
  acceptanceCriteria: string;
}

export interface AuditResult {
  repoName: string;
  commitHash: string;
  auditTimestamp: string;
  auditSummary: string;
  overallHealthScore: number;
  aspectHealthScore: number;
  aspectEffectSummary: string;
  tasks: AuditTask[];
}
