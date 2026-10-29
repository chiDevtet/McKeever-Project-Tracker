"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function AcceptInviteForm({ token, email, defaultName, isAdmin }: { token: string; email: string; defaultName: string; isAdmin: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch("/api/public/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, password }) });
    const body = await res.json().catch(() => null);
    if (!body?.ok) {
      setPending(false);
      setError(body?.error?.message ?? "Could not accept the invitation.");
      return;
    }
    const signIn = await authClient.signIn.email({ email, password });
    setPending(false);
    if (signIn.error) {
      router.replace("/login");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Set up your account</h1>
        <p className="text-sm text-muted-foreground">
          {email}
          {isAdmin ? " · Administrator" : ""}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password (12+ characters)</Label>
        <Input id="password" type="password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || password.length < 12 || !name.trim()}>
        {pending ? "Creating account…" : "Create account and sign in"}
      </Button>
    </form>
  );
}
