"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DivisionFilters({ projects, roles, from, to }: { projects: { id: string; code: string }[]; roles: string[]; from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.getAll("project");
  const set = (k: string, v: string | string[] | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete(k);
    if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
    else if (v) next.set(k, v);
    router.push(`/?${next.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2 text-xs">
      <label>
        <span className="block text-muted-foreground">From week</span>
        <Input type="date" className="h-8 w-36" defaultValue={from} onBlur={(e) => set("from", e.target.value || null)} />
      </label>
      <label>
        <span className="block text-muted-foreground">To week</span>
        <Input type="date" className="h-8 w-36" defaultValue={to} onBlur={(e) => set("to", e.target.value || null)} />
      </label>
      <label>
        <span className="block text-muted-foreground">Role</span>
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={params.get("role") ?? "all"} onChange={(e) => set("role", e.target.value === "all" ? null : e.target.value)}>
          <option value="all">Installers and leadership</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r} only
            </option>
          ))}
          <option value="leadership">Leadership only</option>
        </select>
      </label>
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="text-muted-foreground">Projects</legend>
        {projects.map((p) => {
          const on = selected.length === 0 || selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={`rounded border px-2 py-1 ${on ? "border-brand-line bg-brand text-white" : "bg-background"}`}
              onClick={() => {
                const current = selected.length ? selected : projects.map((x) => x.id);
                const next = current.includes(p.id) ? current.filter((x) => x !== p.id) : [...current, p.id];
                set("project", next.length === projects.length ? null : next);
              }}
            >
              {on ? "✓ " : ""}
              {p.code}
            </button>
          );
        })}
      </fieldset>
      <Button size="sm" variant="ghost" onClick={() => router.push("/")}>
        Reset
      </Button>
    </div>
  );
}
