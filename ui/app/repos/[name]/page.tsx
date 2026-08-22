import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepoDetail, getRepoMemory, type AuditTask, type ProjectMemoryEntry, type RepoAspectState, type RepoAutomationPolicy } from "@/lib/api";
import { mapPriority, relativeTime } from "@/lib/format";
import { scoreColor, priorityColor } from "@/lib/theme";
import { PagePanel } from "@/components/sentinel/page-panel";
import { MeterBar } from "@/components/sentinel/meter-bar";
import { ColorBadge } from "@/components/sentinel/color-badge";
import { ApiErrorBanner } from "@/components/sentinel/empty-state";
import { RepoTasksPanel } from "@/components/sentinel/repo-tasks-panel";
import { RepoMemoryPanel } from "@/components/sentinel/repo-memory-panel";
import { RepoPolicyPanel } from "@/components/sentinel/repo-policy-panel";

interface RepoDetailData {
  repo_name: string;
  health_score: number;
  security_score: number;
  priority: string;
  last_commit_at: string | null;
  tasks: AuditTask[];
  aspect: RepoAspectState | null;
  policy: RepoAutomationPolicy;
}

export default async function RepoDetailPage({ params }: { params: { name: string } }) {
  const { name } = params;

  // Independent try/catch (not a single Promise.all) — repo detail/tasks and
  // project memory are separate endpoints, and a memory-only failure
  // shouldn't take down the primary repo view.
  const [detailResult, memoryResult] = await Promise.allSettled([
    getRepoDetail(name),
    getRepoMemory(name),
  ]);

  const detail = detailResult.status === "fulfilled" ? (detailResult.value as unknown as RepoDetailData) : null;
  const memory: ProjectMemoryEntry[] = memoryResult.status === "fulfilled" ? memoryResult.value : [];
  const memoryError = memoryResult.status === "rejected";

  if (!detail) {
    // Deliberately no mock fallback — see app/repos/page.tsx for the
    // rationale. Show an honest empty/error state instead.
    return (
      <div className="p-5 space-y-4">
        <BackLink />
        <ApiErrorBanner label="repo detail" />
      </div>
    );
  }

  const health = Math.min(100, Math.round(parseFloat(String(detail.health_score ?? 0)) * 10));
  const security = Math.round(parseFloat(String(detail.security_score ?? 0)));
  const priority = mapPriority(detail.priority);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 space-y-5">
        <BackLink />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-s-text">{detail.repo_name}</h1>
              <ColorBadge color={priorityColor(priority)} size="xs" bordered>{priority}</ColorBadge>
              {detail.aspect && (
                <ColorBadge color="#00D4FF" size="xs" bordered>
                  🎯 {detail.aspect.aspect} · sprint {detail.aspect.sprintCount}
                </ColorBadge>
              )}
            </div>
            <div className="text-[11px] text-s-muted font-mono mt-1">
              Last commit {relativeTime(detail.last_commit_at)}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-widest text-s-dim mb-1">Health</div>
              <div className="flex items-center gap-2 w-28">
                <MeterBar pct={health} color={scoreColor(health)} height={4} />
                <span className="text-xs font-mono font-bold w-6 text-right" style={{ color: scoreColor(health) }}>{health}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-widest text-s-dim mb-1">Security</div>
              <div className="flex items-center gap-2 w-28">
                <MeterBar pct={security} color={scoreColor(security)} height={4} />
                <span className="text-xs font-mono font-bold w-6 text-right" style={{ color: scoreColor(security) }}>{security}</span>
              </div>
            </div>
          </div>
        </div>

        <PagePanel title={`Tasks (${detail.tasks.length})`}>
          <RepoTasksPanel tasks={detail.tasks} />
        </PagePanel>

        <PagePanel title="Automation Policy">
          <RepoPolicyPanel repoName={name} policy={detail.policy} />
        </PagePanel>

        <PagePanel title="Project Memory">
          {memoryError && <ApiErrorBanner label="project memory" className="m-4" />}
          <RepoMemoryPanel repoName={name} entries={memory} />
        </PagePanel>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/repos" className="inline-flex items-center gap-1.5 text-[11px] text-s-muted hover:text-s-text transition-colors">
      <ArrowLeft size={12} /> Back to repos
    </Link>
  );
}
