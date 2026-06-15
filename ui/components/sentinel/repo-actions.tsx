"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions";

export function RepoActions() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const run = async (label: string, path: string) => {
    setLoading(label);
    try {
      await callAction(path);
      router.refresh();
    } catch {}
    setLoading(null);
  };

  return (
    <div className="flex gap-2">
      <button
        disabled={!!loading}
        onClick={() => run("audit", "/api/system/audit-all")}
        className="px-3 py-1.5 text-[11px] rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-border-2 transition-all disabled:opacity-40"
      >
        {loading === "audit" ? "Auditing…" : "Audit All"}
      </button>
      <button
        disabled={!!loading}
        onClick={() => run("scan", "/api/system/security-scan")}
        className="px-3 py-1.5 text-[11px] rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-border-2 transition-all disabled:opacity-40"
      >
        {loading === "scan" ? "Scanning…" : "Run Security Scan"}
      </button>
    </div>
  );
}
