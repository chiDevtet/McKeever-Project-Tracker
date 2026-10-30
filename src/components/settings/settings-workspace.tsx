"use client";

import { Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { ThemeToggle } from "@/components/theme/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/domain/dates";
import { rpc, RpcError } from "@/lib/rpc-client";
import type { getSettings } from "@/server/services/workspace";

type Settings = Awaited<ReturnType<typeof getSettings>>;

const splitList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SettingsWorkspace({ settings, isAdmin }: { settings: Settings; isAdmin: boolean }) {
  const router = useRouter();
  const w = settings.workspace;
  const [form, setForm] = useState({ name: w.name, appDisplayName: w.appDisplayName, brandColor: w.brandColor, defaultTimezone: w.defaultTimezone, divisionTimezone: w.divisionTimezone, installerRoles: w.installerRoles.join(", "), leadershipRoles: w.leadershipRoles.join(", "), milestoneCodes: w.milestoneCodes.join(", ") });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState({ role: w.installerRoles[0] ?? "Installer", startDate: "", endDate: "", maxHeadcount: "", note: "" });
  const [limitError, setLimitError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await rpc("settings.update", { ...form, installerRoles: splitList(form.installerRoles), leadershipRoles: splitList(form.leadershipRoles), milestoneCodes: splitList(form.milestoneCodes) });
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof RpcError ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | null) {
    const fd = new FormData();
    if (file) fd.set("file", file);
    const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    if (!body?.ok) return toast.error(body?.error?.message ?? "Logo not saved");
    toast.success(file ? "Logo updated" : "Logo removed");
    router.refresh();
  }

  const field = (k: keyof typeof form, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`s-${k}`}>{label}</Label>
      <Input id={`s-${k}`} disabled={!isAdmin} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <div className="grid gap-4 p-3 sm:p-4 xl:grid-cols-2">
      <section className="space-y-3 rounded-lg border bg-background p-3">
        <h2 className="text-sm font-semibold">Company and branding</h2>
        {field("name", "Company name", "Printed on reports and exports.")}
        {field("appDisplayName", "Application name")}
        <div className="space-y-1">
          <Label htmlFor="s-color">Brand color</Label>
          <div className="flex items-center gap-2">
            <input id="s-color" type="color" disabled={!isAdmin} value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} className="h-9 w-12 rounded border" />
            <Input aria-label="Brand color hex" disabled={!isAdmin} className="w-32 font-mono" value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium">Logo</span>
          <div className="flex flex-wrap items-center gap-2">
            {w.logoFileId ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, access-checked file route
              <img src={`/api/files/${w.logoFileId}?inline=1`} alt="Current logo" className="max-h-12 max-w-[12rem] rounded border bg-white object-contain p-1" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo uploaded.</span>
            )}
            {isAdmin ? (
              <>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  <Upload className="size-3.5" /> Upload PNG, JPEG, or WebP
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)} />
                </label>
                {w.logoFileId ? (
                  <Button size="sm" variant="ghost" onClick={() => void uploadLogo(null)}>
                    Remove
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-3">
        <h2 className="text-sm font-semibold">Division planning</h2>
        {field("divisionTimezone", "Division timezone", "Weekly buckets of the division forecast use this timezone (IANA name, e.g. America/New_York).")}
        {field("defaultTimezone", "Default project timezone")}
        {field("installerRoles", "Installer roles", "Comma-separated. Workforce pools use these roles.")}
        {field("leadershipRoles", "Leadership roles", "Comma-separated. Counted once per named person, separate from installers.")}
        {field("milestoneCodes", "Milestone codes", "Comma-separated, e.g. SWD, FEA, NEA, H2C, PFHO.")}
        <FormError message={error} />
        {isAdmin ? (
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only administrators can change settings.</p>
        )}
      </section>

      <section id="availability" className="space-y-2 rounded-lg border bg-background p-3">
        <h2 className="text-sm font-semibold">Workforce availability</h2>
        <p className="text-xs text-muted-foreground">Optional limits by role and date range. Where no limit covers a week, the division dashboard shows availability as not set instead of claiming staffing is sufficient.</p>
        {settings.limits.length === 0 ? <p className="text-sm text-muted-foreground">No limits entered.</p> : null}
        <ul className="divide-y text-sm">
          {settings.limits.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-1">
              <span className="font-medium">{l.role}</span> ≤ <span className="tabular">{l.maxHeadcount}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(l.startDate)} – {formatDate(l.endDate)}
                {l.note ? ` · ${l.note}` : ""}
              </span>
              {isAdmin ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove ${l.role} limit`}
                  onClick={async () => {
                    try {
                      await rpc("division.removeLimit", { id: l.id });
                      router.refresh();
                    } catch (e) {
                      toast.error(e instanceof RpcError ? e.message : "Not removed");
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {isAdmin ? (
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label>
              <span className="block text-muted-foreground">Role</span>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={limit.role} onChange={(e) => setLimit({ ...limit, role: e.target.value })}>
                {w.installerRoles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-muted-foreground">From</span>
              <Input type="date" className="h-9 w-40" value={limit.startDate} onChange={(e) => setLimit({ ...limit, startDate: e.target.value })} />
            </label>
            <label>
              <span className="block text-muted-foreground">To</span>
              <Input type="date" className="h-9 w-40" value={limit.endDate} onChange={(e) => setLimit({ ...limit, endDate: e.target.value })} />
            </label>
            <label>
              <span className="block text-muted-foreground">Max headcount</span>
              <Input inputMode="numeric" className="h-9 w-24" value={limit.maxHeadcount} onChange={(e) => setLimit({ ...limit, maxHeadcount: e.target.value })} />
            </label>
            <label>
              <span className="block text-muted-foreground">Note</span>
              <Input className="h-9 w-48" value={limit.note} onChange={(e) => setLimit({ ...limit, note: e.target.value })} />
            </label>
            <Button
              disabled={!limit.startDate || !limit.endDate || !limit.maxHeadcount}
              onClick={async () => {
                const n = Number(limit.maxHeadcount);
                if (!Number.isInteger(n) || n < 0) return setLimitError("Max headcount must be a whole number of people (0 or more).");
                setLimitError(null);
                try {
                  await rpc("division.addLimit", { role: limit.role, startDate: limit.startDate, endDate: limit.endDate, maxHeadcount: n, note: limit.note.trim() || null });
                  setLimit({ ...limit, startDate: "", endDate: "", maxHeadcount: "", note: "" });
                  router.refresh();
                } catch (e) {
                  setLimitError(e instanceof RpcError ? e.message : "Not added");
                }
              }}
            >
              Add limit
            </Button>
          </div>
        ) : null}
        <FormError message={limitError} />
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3 text-sm">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="text-xs text-muted-foreground">Soft dark is the default. Your choice is saved in this browser and applies to every page.</p>
        <ThemeToggle />
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3 text-sm">
        <h2 className="text-sm font-semibold">System status</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Environment</dt>
          <dd>{settings.status.appEnv}</dd>
          <dt className="text-muted-foreground">Application URL</dt>
          <dd className="break-all">{settings.status.appUrl}</dd>
          <dt className="text-muted-foreground">Mail</dt>
          <dd>{settings.status.mail}</dd>
          <dt className="text-muted-foreground">File storage</dt>
          <dd className="break-all">{settings.status.storage}</dd>
        </dl>
        {settings.status.outbox ? (
          <p className="text-xs">
            Development mail outbox:{" "}
            <Link className="underline" href="/dev/outbox">
              /dev/outbox
            </Link>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">Secrets (database, storage, and SMTP credentials) are configured through the server environment and are never shown here.</p>
      </section>
    </div>
  );
}
