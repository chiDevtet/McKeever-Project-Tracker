"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WEEKDAY_SHORT } from "@/domain/dates";
import { rpc, RpcError } from "@/lib/rpc-client";

const SUGGESTED_SYSTEMS = [
  { key: "fire-alarm", name: "Fire alarm", sourceAliases: [] },
  { key: "vesda", name: "VESDA smoke detection", sourceAliases: [] },
  { key: "responder-radio", name: "Emergency responder radio", sourceAliases: ["ERRS", "ERRC"] },
  { key: "cellular", name: "Cellular boosting", sourceAliases: [] },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "system";

export function CreateProjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", customer: "", generalContractor: "", owner: "", description: "", timezone: "America/New_York", hoursPerDay: "8", dayStart: "07:00" });
  const [workdays, setWorkdays] = useState([1, 2, 3, 4, 5]);
  const [systems, setSystems] = useState(SUGGESTED_SYSTEMS.map((s) => ({ ...s })));
  const [newSystem, setNewSystem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const project = await rpc("projects.create", {
        code: form.code,
        name: form.name,
        customer: form.customer || null,
        generalContractor: form.generalContractor || null,
        owner: form.owner || null,
        description: form.description || null,
        timezone: form.timezone,
        hoursPerDay: Number(form.hoursPerDay),
        dayStart: form.dayStart,
        workdays,
        systems,
      });
      setOpen(false);
      router.push(`/projects/${project.id}/manpower`);
      router.refresh();
    } catch (err) {
      setError(err instanceof RpcError ? err.message : "Could not create the project.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Manual project setup. A source schedule is optional and can be imported later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Code *</Label>
              <Input id="code" required value={form.code} onChange={set("code")} placeholder="CMH139" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" required value={form.name} onChange={set("name")} placeholder="AWS CMH139" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer">Customer (contracting)</Label>
              <Input id="customer" value={form.customer} onChange={set("customer")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc">General contractor</Label>
              <Input id="gc" value={form.generalContractor} onChange={set("generalContractor")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Owner</Label>
              <Input id="owner" value={form.owner} onChange={set("owner")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={2} value={form.description} onChange={set("description")} />
          </div>
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Working calendar</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
              {WEEKDAY_SHORT.map((d, i) => {
                const on = workdays.includes(i + 1);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setWorkdays(on ? workdays.filter((x) => x !== i + 1) : [...workdays, i + 1].sort())} className={`rounded border px-2.5 py-1 text-xs ${on ? "border-brand-line bg-brand text-white" : "bg-background"}`}>
                    {on ? "✓ " : ""}
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="hours">Hours per working day</Label>
                <Input id="hours" type="number" min={1} max={24} step={0.5} value={form.hoursPerDay} onChange={set("hoursPerDay")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="start">Day starts</Label>
                <Input id="start" type="time" value={form.dayStart} onChange={set("dayStart")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Input id="tz" value={form.timezone} onChange={set("timezone")} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Weeks start Monday. Holidays, longer days, added workdays, and shifts are configured after creation.</p>
          </fieldset>
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Systems (project configuration)</legend>
            <ul className="flex flex-wrap gap-1.5">
              {systems.map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs">
                  {s.name}
                  {s.sourceAliases.length ? <span className="text-muted-foreground">(aliases {s.sourceAliases.join(", ")})</span> : null}
                  <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setSystems(systems.filter((x) => x.key !== s.key))}>
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input aria-label="Add system" value={newSystem} onChange={(e) => setNewSystem(e.target.value)} placeholder="Add a system" />
              <Button
                type="button"
                variant="outline"
                disabled={!newSystem.trim()}
                onClick={() => {
                  let key = slug(newSystem);
                  while (systems.some((s) => s.key === key)) key += "-2";
                  setSystems([...systems, { key, name: newSystem.trim(), sourceAliases: [] }]);
                  setNewSystem("");
                }}
              >
                Add
              </Button>
            </div>
          </fieldset>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.code.trim() || !form.name.trim() || workdays.length === 0}>
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
