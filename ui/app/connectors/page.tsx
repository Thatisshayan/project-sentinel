import { cn } from "@/lib/utils";

const CONNECTORS = [
  // Connected
  { name:"GitHub",    color:"#e6edf3", bg:"#161b22", status:"connected", sync:"2m ago",   category:"Dev" },
  { name:"Vercel",    color:"#ffffff", bg:"#000000", status:"connected", sync:"5m ago",   category:"Deploy" },
  { name:"Linear",    color:"#5E6AD2", bg:"#1a1a2e", status:"connected", sync:"1h ago",   category:"PM" },
  { name:"Slack",     color:"#E01E5A", bg:"#1a0a0f", status:"connected", sync:"10m ago",  category:"Comms" },
  { name:"Railway",   color:"#B835F4", bg:"#12001a", status:"connected", sync:"3m ago",   category:"Deploy" },
  { name:"CostPilot", color:"#C8961C", bg:"#1a1200", status:"connected", sync:"live",     category:"Billing", isOwn: true },
  { name:"Notion",    color:"#ffffff", bg:"#1a1a1a", status:"connected", sync:"15m ago",  category:"PM" },
  { name:"ClickUp",   color:"#7B68EE", bg:"#0e0a1a", status:"connected", sync:"30m ago",  category:"PM" },
  { name:"Telegram",  color:"#26A5E4", bg:"#001520", status:"connected", sync:"live",     category:"Comms" },
  // Not configured
  { name:"Stripe",    color:"#6772e5", bg:"#0a0a1a", status:"missing",   sync:null,       category:"Billing" },
  { name:"Supabase",  color:"#3FCF8E", bg:"#001a0e", status:"missing",   sync:null,       category:"DB" },
  { name:"Sentry",    color:"#F55257", bg:"#1a0001", status:"missing",   sync:null,       category:"Monitor" },
  { name:"Figma",     color:"#a259ff", bg:"#120020", status:"missing",   sync:null,       category:"Design" },
  { name:"Datadog",   color:"#632CA6", bg:"#0d0015", status:"missing",   sync:null,       category:"Monitor" },
  { name:"Discord",   color:"#5865F2", bg:"#0d0f25", status:"missing",   sync:null,       category:"Comms" },
  { name:"PagerDuty", color:"#25C151", bg:"#001a08", status:"missing",   sync:null,       category:"Monitor" },
  { name:"Resend",    color:"#ffffff", bg:"#111111", status:"missing",   sync:null,       category:"Email" },
  { name:"AWS",       color:"#FF9900", bg:"#1a0f00", status:"missing",   sync:null,       category:"Cloud" },
  { name:"Jira",      color:"#0052CC", bg:"#000d1a", status:"missing",   sync:null,       category:"PM" },
  { name:"Airtable",  color:"#18BFFF", bg:"#001520", status:"missing",   sync:null,       category:"PM" },
  { name:"Zapier",    color:"#FF4A00", bg:"#1a0800", status:"missing",   sync:null,       category:"Auto" },
];

const connected = CONNECTORS.filter(c => c.status === "connected");
const missing   = CONNECTORS.filter(c => c.status !== "connected");

export default function ConnectorsPage() {
  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs text-s-muted">
          <span><span className="text-s-green font-semibold">{connected.length}</span> connected</span>
          <span><span className="text-s-dim font-semibold">{missing.length}</span> available</span>
        </div>
        <button className="px-3 py-1.5 text-[11px] rounded border border-s-border text-s-muted hover:text-s-text transition-all">
          + Request Connector
        </button>
      </div>

      {/* Connected */}
      <section>
        <div className="text-[9px] font-bold uppercase tracking-widest text-s-dim mb-3">Connected</div>
        <div className="grid gap-0 border border-s-border rounded-lg overflow-hidden"
          style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
          {connected.map((c, i) => (
            <ConnCard key={c.name} c={c} isLast={i === connected.length - 1} colIdx={i % 4} rowIdx={Math.floor(i/4)} totalRows={Math.ceil(connected.length/4)} />
          ))}
        </div>
      </section>

      {/* Available */}
      <section>
        <div className="text-[9px] font-bold uppercase tracking-widest text-s-dim mb-3">Available</div>
        <div className="grid gap-0 border border-s-border rounded-lg overflow-hidden"
          style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
          {missing.map((c, i) => (
            <ConnCard key={c.name} c={c} isLast={i === missing.length - 1} colIdx={i % 4} rowIdx={Math.floor(i/4)} totalRows={Math.ceil(missing.length/4)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ConnCard({ c, colIdx, rowIdx, totalRows }: {
  c: typeof CONNECTORS[0];
  isLast: boolean;
  colIdx: number;
  rowIdx: number;
  totalRows: number;
}) {
  const isLastRow = rowIdx === totalRows - 1;
  const isLastCol = colIdx === 3;
  return (
    <div className={cn(
      "p-3 hover:bg-white/[0.025] transition-colors",
      !isLastCol && "border-r border-s-border",
      !isLastRow && "border-b border-s-border",
      (c as any).isOwn && "bg-[#C8961C08] border-[#C8961C20]"
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ background: c.color + "15", border: `1px solid ${c.color}25`, color: c.color }}
        >
          {c.name[0]}
        </div>
        <div className="min-w-0">
          <div className={cn("text-xs font-semibold", (c as any).isOwn && "text-s-gold")}>{c.name}</div>
          <div className="text-[9px] text-s-dim">{c.category}</div>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <span
          className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", c.sync === "live" && "live-dot")}
          style={{ background: c.status === "connected" ? "#22C55E" : "#444" }}
        />
        <span className={cn("text-[10px]", c.status === "connected" ? "text-s-green" : "text-s-dim")}>
          {c.status === "connected"
            ? c.sync === "live" ? "Live" : `Synced ${c.sync}`
            : "Not configured"}
        </span>
      </div>

      <button className={cn(
        "w-full text-[10px] py-1 rounded border transition-all",
        c.status === "connected"
          ? (c as any).isOwn
            ? "border-s-gold/30 text-s-gold hover:bg-s-gold/10"
            : "border-s-border text-s-muted hover:text-s-text hover:border-s-border-2"
          : "border-s-ind/30 text-s-ind hover:bg-s-ind/10"
      )}>
        {c.status === "connected"
          ? (c as any).isOwn ? "Open CostPilot →" : "Configure"
          : "Connect →"}
      </button>
    </div>
  );
}
