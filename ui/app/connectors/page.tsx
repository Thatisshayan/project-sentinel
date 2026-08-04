import { cn } from "@/lib/utils";
import { getIntegrationsStatus, type ConnectorStatus } from "@/lib/api";

const CONNECTOR_META: Record<string, { color: string; category: string; how: string }> = {
  GitHub:       { color: "#e6edf3", category: "Dev",    how: "Webhook on push/PR events" },
  Telegram:     { color: "#26A5E4", category: "Comms",  how: "Bot webhook — commands & alerts" },
  Notion:       { color: "#ffffff", category: "PM",     how: "API — project status & task sync" },
  // Backend renamed this connector from "Railway" when hosting migrated to a
  // self-hosted Oracle Cloud VM (docs/ORACLE_DEPLOY.md) — it now checks the
  // app's own public /health endpoint instead of an external deploy API.
  "Oracle host": { color: "#C74634", category: "Deploy", how: "HTTPS — self-hosted VM health check" },
};

const AVAILABLE_CONNECTORS = [
  { name: "Vercel",    color: "#ffffff", category: "Deploy",  status: "available" },
  { name: "Slack",     color: "#E01E5A", category: "Comms",   status: "available" },
  { name: "Linear",    color: "#5E6AD2", category: "PM",      status: "available" },
  { name: "Sentry",    color: "#F55257", category: "Monitor", status: "available" },
  { name: "Datadog",   color: "#632CA6", category: "Monitor", status: "available" },
  { name: "Stripe",    color: "#6772e5", category: "Billing", status: "available" },
  { name: "Supabase",  color: "#3FCF8E", category: "DB",      status: "available" },
  { name: "Discord",   color: "#5865F2", category: "Comms",   status: "available" },
  { name: "PagerDuty", color: "#25C151", category: "Alerts",  status: "available" },
  { name: "AWS",       color: "#FF9900", category: "Cloud",   status: "available" },
  { name: "Jira",      color: "#0052CC", category: "PM",      status: "available" },
  { name: "Resend",    color: "#ffffff", category: "Email",   status: "available" },
];

export default async function ConnectorsPage() {
  let liveConnectors: ConnectorStatus[] = [];
  try {
    const result = await getIntegrationsStatus();
    liveConnectors = result.connectors;
  } catch {
    // API unavailable — fall back to empty state
  }

  const connected = liveConnectors.filter(c => c.status === 'connected').length;

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs text-s-muted">
          <span><span className="text-s-green font-semibold">{connected}</span> connected</span>
          <span><span className="text-s-dim font-semibold">{AVAILABLE_CONNECTORS.length}</span> available</span>
        </div>
      </div>

      <section>
        <div className="text-[9px] font-bold uppercase tracking-widest text-s-dim mb-3">Connected</div>
        <div className="grid gap-0 border border-s-border rounded-lg overflow-hidden"
          style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {liveConnectors.map((c, i) => {
            const meta = CONNECTOR_META[c.name] ?? { color: "#888", category: "Other", how: "" };
            return (
              <ConnCard
                key={c.name}
                c={{ ...c, color: meta.color, category: meta.category, how: meta.how }}
                colIdx={i % 4}
                rowIdx={Math.floor(i / 4)}
                totalRows={Math.ceil(liveConnectors.length / 4)}
              />
            );
          })}
          {liveConnectors.length === 0 && (
            <div className="col-span-4 p-4 text-xs text-s-dim">Could not reach API — check backend connection.</div>
          )}
        </div>
      </section>

      <section>
        <div className="text-[9px] font-bold uppercase tracking-widest text-s-dim mb-3">Available — not yet wired</div>
        <div className="grid gap-0 border border-s-border rounded-lg overflow-hidden"
          style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {AVAILABLE_CONNECTORS.map((c, i) => (
            <ConnCard key={c.name} c={c} colIdx={i % 4} rowIdx={Math.floor(i / 4)} totalRows={Math.ceil(AVAILABLE_CONNECTORS.length / 4)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ConnCard({ c, colIdx, rowIdx, totalRows }: {
  c: { name: string; color: string; category: string; status: string; how?: string; detail?: string | null };
  colIdx: number; rowIdx: number; totalRows: number;
}) {
  const isLastRow = rowIdx === totalRows - 1;
  const isLastCol = colIdx === 3;
  const connected = c.status === "connected";
  const isError   = c.status === "error";

  const dotColor = connected ? "#22C55E" : isError ? "#EF4444" : "#444";
  const labelColor = connected ? "text-s-green" : isError ? "text-red-400" : "text-s-dim";
  const label = connected ? "Connected" : isError ? "Error" : "Not configured";

  return (
    <div className={cn(
      "p-3 hover:bg-white/[0.025] transition-colors",
      !isLastCol && "border-r border-s-border",
      !isLastRow && "border-b border-s-border",
    )}>
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ background: c.color + "15", border: `1px solid ${c.color}25`, color: c.color }}
        >
          {c.name[0]}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold">{c.name}</div>
          <div className="text-[9px] text-s-dim">{c.category}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
        <span className={cn("text-[10px]", labelColor)}>{label}</span>
      </div>

      {connected && c.how && (
        <div className="text-[9px] text-s-dim leading-relaxed">{c.how}</div>
      )}
      {isError && c.detail && (
        <div className="text-[9px] text-red-400/70 leading-relaxed truncate" title={c.detail}>{c.detail}</div>
      )}
    </div>
  );
}
