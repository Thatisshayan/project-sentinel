"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { ProjectMemoryEntry, ProjectMemoryType } from "@/lib/api";
import { memoryTypeColor } from "@/lib/theme";
import { relativeTime } from "@/lib/format";
import { useSafeReducedMotion } from "@/lib/motion";
import { callAction } from "@/lib/actions";
import { ColorBadge } from "./color-badge";
import { EmptyNote } from "./empty-state";

const TYPES: ProjectMemoryType[] = ["dismissed_finding", "convention", "decision", "note"];

export function RepoMemoryPanel({ repoName, entries }: { repoName: string; entries: ProjectMemoryEntry[] }) {
  const router = useRouter();
  const reduced = useSafeReducedMotion();
  const [type, setType] = useState<ProjectMemoryType>("note");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const add = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await callAction(`/api/repo/${repoName}/memory`, { type, content: trimmed });
      setContent("");
      router.refresh();
    } catch {
      // callAction already raised an error toast
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await callAction(`/api/repo/${repoName}/memory/${id}`, undefined, "DELETE");
      router.refresh();
    } catch {
      // callAction already raised an error toast
    }
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div>
      {/* Add form */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-s-border">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ProjectMemoryType)}
          aria-label="Memory entry type"
          className="bg-s-surface border border-s-border rounded px-2 py-1 text-[11px] text-s-text outline-none focus:border-s-ind/50"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>{t.replace("_", " ")}</option>
          ))}
        </select>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Record a convention, decision, or dismissed finding…"
          maxLength={2000}
          className="flex-1 bg-s-surface border border-s-border rounded px-2.5 py-1.5 text-xs text-s-text placeholder:text-s-dim outline-none focus:border-s-ind/50"
        />
        <button
          onClick={add}
          disabled={saving || !content.trim()}
          className="px-3 py-1.5 text-[11px] rounded border border-s-ind/40 text-s-ind hover:bg-s-ind/10 transition-all disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyNote>No project memory recorded yet.</EmptyNote>
      ) : (
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              className="group flex items-start gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02] overflow-hidden"
            >
              <ColorBadge color={memoryTypeColor(entry.type)} size="2xs" uppercase>
                {entry.type.replace("_", " ")}
              </ColorBadge>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-s-text">{entry.content}</div>
                <div className="text-[9px] text-s-dim font-mono mt-0.5">
                  {entry.added_by ?? "unknown"} · {relativeTime(entry.created_at)}
                </div>
              </div>
              <button
                onClick={() => remove(entry.id)}
                disabled={deletingIds.has(entry.id)}
                aria-label="Delete memory entry"
                title="Delete this memory entry"
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10 text-s-dim hover:text-s-red disabled:opacity-40 flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
