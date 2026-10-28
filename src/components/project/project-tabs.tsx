"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { seg: "manpower", label: "Manpower" },
  { seg: "schedule", label: "Schedule" },
  { seg: "progress", label: "Progress" },
  { seg: "imports", label: "Imports" },
  { seg: "reports", label: "Reports" },
  { seg: "plans", label: "Plans & history" },
  { seg: "setup", label: "Setup" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const plan = search.get("plan");

  useEffect(() => {
    document.cookie = `fieldops_project=${encodeURIComponent(projectId)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, [projectId]);

  return (
    <nav aria-label="Project sections" className="-mb-px mt-2 flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const href = `/projects/${projectId}/${t.seg}${plan && ["manpower", "schedule", "reports"].includes(t.seg) ? `?plan=${plan}` : ""}`;
        const active = pathname.startsWith(`/projects/${projectId}/${t.seg}`);
        return (
          <Link key={t.seg} href={href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
