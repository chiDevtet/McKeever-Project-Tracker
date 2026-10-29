"use client";

import { Mail, Plus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/format";
import { rpc, RpcError } from "@/lib/rpc-client";
import type { listPeople } from "@/server/services/people";
import type { listUsers } from "@/server/services/users";

type People = Awaited<ReturnType<typeof listPeople>>;
type Users = Awaited<ReturnType<typeof listUsers>>;
type ProjectRole = "PROJECT_MANAGER" | "INTERNAL_VIEWER" | "FOREMAN_VIEWER";

const ROLE_LABEL: Record<ProjectRole, string> = { PROJECT_MANAGER: "Project manager (edit)", INTERNAL_VIEWER: "Internal viewer (read)", FOREMAN_VIEWER: "Foreman viewer (read)" };
const selectCls = "h-8 rounded-md border bg-background px-2 text-xs";

async function call<T>(p: Promise<T>, ok: string, refresh: () => void): Promise<T | null> {
  try {
    const r = await p;
    toast.success(ok);
    refresh();
    return r;
  } catch (e) {
    toast.error(e instanceof RpcError ? e.message : "Not saved");
    return null;
  }
}

export function PeopleWorkspace({ people, users, canManagePeople, viewerId }: { people: People; users: Users | null; canManagePeople: boolean; viewerId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<People[number] | "new" | null>(null);
  const [inviting, setInviting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <section className="space-y-2 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Personnel</h2>
          <p className="text-xs text-muted-foreground">Named people who can lead work (PMs, foremen). A personnel record is separate from a login account and from a project staffing role.</p>
          <label className="ml-auto flex items-center gap-1 text-xs">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          {canManagePeople ? (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add person
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Name</th>
                <th>Title</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people
                .filter((p) => showArchived || !p.archived)
                .map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1.5 font-medium">
                      {p.displayName} {p.archived ? <Badge variant="secondary">Archived</Badge> : null}
                    </td>
                    <td className="text-xs">{p.title ?? "—"}</td>
                    <td className="text-xs">{p.email ?? "—"}</td>
                    <td className="text-xs">{p.phone ?? "—"}</td>
                    <td className="text-xs text-muted-foreground">{p.loginEmail ?? "No login"}</td>
                    <td className="text-right">
                      {canManagePeople ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {people.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No personnel records yet.</p> : null}
        </div>
      </section>

      {users ? (
        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Users and access</h2>
            <p className="text-xs text-muted-foreground">Sign-up is invite-only. Administrators see every project; other users see only projects they are granted.</p>
            <Button size="sm" className="ml-auto" onClick={() => setInviting(true)}>
              <UserPlus className="size-4" /> Invite user
            </Button>
          </div>
          <ul className="divide-y text-sm">
            {users.users.map((u) => (
              <li key={u.userId} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs text-muted-foreground">{u.email}</span>
                  <Badge variant={u.role === "ADMINISTRATOR" ? "default" : "outline"}>{u.role === "ADMINISTRATOR" ? "Administrator" : "Member"}</Badge>
                  {u.disabled ? <Badge variant="destructive">Disabled</Badge> : null}
                  {u.userId !== viewerId ? (
                    <span className="ml-auto space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => void call(rpc("users.setStatus", { userId: u.userId, role: u.role === "ADMINISTRATOR" ? "MEMBER" : "ADMINISTRATOR" }), "Role updated", refresh)}>
                        {u.role === "ADMINISTRATOR" ? "Make member" : "Make administrator"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={u.disabled ? "" : "text-destructive"}
                        onClick={() => {
                          if (!u.disabled && !window.confirm(`Disable ${u.name}? Their sessions end immediately and they can no longer sign in or download files.`)) return;
                          void call(rpc("users.setStatus", { userId: u.userId, disabled: !u.disabled }), u.disabled ? "User enabled" : "User disabled", refresh);
                        }}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </Button>
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-muted-foreground">You</span>
                  )}
                </div>
                {u.role !== "ADMINISTRATOR" ? <Grants user={u} projects={users.projects} refresh={refresh} /> : <p className="text-xs text-muted-foreground">Access to all projects.</p>}
              </li>
            ))}
          </ul>
          {users.invitations.length ? (
            <div>
              <h3 className="text-xs font-semibold">Pending invitations</h3>
              <ul className="divide-y text-sm">
                {users.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 py-1">
                    <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                    {i.name} <span className="text-xs text-muted-foreground">{i.email}</span>
                    <Badge variant="outline">{i.workspaceRole === "ADMINISTRATOR" ? "Administrator" : "Member"}</Badge>
                    <span className="text-xs text-muted-foreground">expires {formatTimestamp(i.expiresAt)}</span>
                    <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void call(rpc("users.revokeInvitation", { invitationId: i.id }), "Invitation revoked", refresh)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {editing ? <PersonDialog person={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {inviting && users ? <InviteDialog projects={users.projects} onClose={() => setInviting(false)} /> : null}
    </div>
  );
}

function Grants({ user, projects, refresh }: { user: Users["users"][number]; projects: Users["projects"]; refresh: () => void }) {
  const [add, setAdd] = useState({ projectId: "", role: "INTERNAL_VIEWER" as ProjectRole });
  const name = new Map(projects.map((p) => [p.id, `${p.code} ${p.name}`]));
  const available = projects.filter((p) => !user.memberships.some((m) => m.projectId === p.id));
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {user.memberships.length === 0 ? <span className="text-muted-foreground">No project access.</span> : null}
      {user.memberships.map((m) => (
        <span key={m.projectId} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5">
          {name.get(m.projectId)}
          <select aria-label={`Role on ${name.get(m.projectId)}`} className="h-6 rounded border bg-background text-[11px]" value={m.role} onChange={(e) => void call(rpc("users.grant", { projectId: m.projectId, userId: user.userId, role: e.target.value as ProjectRole }), "Access updated", refresh)}>
            {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button type="button" className="text-destructive" aria-label={`Revoke access to ${name.get(m.projectId)}`} onClick={() => void call(rpc("users.revoke", { projectId: m.projectId, userId: user.userId }), "Access revoked", refresh)}>
            ✕
          </button>
        </span>
      ))}
      {available.length ? (
        <span className="inline-flex items-center gap-1">
          <select aria-label="Project to grant" className={selectCls} value={add.projectId} onChange={(e) => setAdd({ ...add, projectId: e.target.value })}>
            <option value="">Grant project…</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
          <select aria-label="Project role" className={selectCls} value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as ProjectRole })}>
            {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!add.projectId} onClick={() => void call(rpc("users.grant", { projectId: add.projectId, userId: user.userId, role: add.role }), "Access granted", refresh).then(() => setAdd({ ...add, projectId: "" }))}>
            Grant
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function PersonDialog({ person, onClose }: { person: People[number] | null; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: person?.displayName ?? "", title: person?.title ?? "", email: person?.email ?? "", phone: person?.phone ?? "", notes: person?.notes ?? "", archived: person?.archived ?? false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { displayName: form.displayName.trim(), title: form.title.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, notes: form.notes.trim() || null };
      if (person) await rpc("people.update", { id: person.id, ...body, archived: form.archived });
      else await rpc("people.create", body);
      toast.success(person ? "Saved" : "Person added");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof RpcError ? e.message : "Not saved");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{person ? `Edit ${person.displayName}` : "Add person"}</DialogTitle>
          <DialogDescription>Archived people stay on past assignments and reports but are not offered for new ones.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(
            [
              ["displayName", "Name"],
              ["title", "Title"],
              ["email", "Email"],
              ["phone", "Phone"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`p-${k}`}>{label}</Label>
              <Input id={`p-${k}`} type={k === "email" ? "email" : "text"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="p-notes">Notes</Label>
            <Textarea id="p-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {person ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} /> Archived
            </label>
          ) : null}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !form.displayName.trim()} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ projects, onClose }: { projects: Users["projects"]; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", workspaceRole: "MEMBER" as "MEMBER" | "ADMINISTRATOR" });
  const [grants, setGrants] = useState<Record<string, ProjectRole | "">>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>The invitee receives a one-time link (valid seven days) to set their own password. No password is ever sent or shown.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <div className="space-y-1">
            <Label htmlFor="i-name">Name</Label>
            <Input id="i-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="i-email">Email</Label>
            <Input id="i-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={form.workspaceRole === "MEMBER"} onChange={() => setForm({ ...form, workspaceRole: "MEMBER" })} /> Member (granted projects only)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={form.workspaceRole === "ADMINISTRATOR"} onChange={() => setForm({ ...form, workspaceRole: "ADMINISTRATOR" })} /> Administrator
            </label>
          </fieldset>
          {form.workspaceRole === "MEMBER" ? (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Project access</span>
              {projects.map((p) => (
                <label key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {p.code} {p.name}
                  </span>
                  <select className={selectCls} value={grants[p.id] ?? ""} onChange={(e) => setGrants({ ...grants, [p.id]: e.target.value as ProjectRole | "" })}>
                    <option value="">No access</option>
                    {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.email.trim() || !form.name.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await rpc("users.invite", { email: form.email.trim(), name: form.name.trim(), workspaceRole: form.workspaceRole, projectGrants: form.workspaceRole === "MEMBER" ? Object.entries(grants).filter(([, r]) => r).map(([projectId, role]) => ({ projectId, role: role as ProjectRole })) : [] });
                toast.success(`Invitation sent to ${form.email.trim()}`);
                router.refresh();
                onClose();
              } catch (e) {
                setError(e instanceof RpcError ? e.message : "Invitation not sent");
                setBusy(false);
              }
            }}
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
