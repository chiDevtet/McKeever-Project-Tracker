"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || linkError) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Link not valid</h1>
        <p className="text-sm text-muted-foreground">This reset link is invalid or expired.</p>
        <Link href="/forgot-password" className="text-sm underline">
          Request a new link
        </Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Password changed</h1>
        <p className="text-sm text-muted-foreground">Other sessions were signed out.</p>
        <Link href="/login" className="text-sm underline">
          Sign in
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (error) setError(error.message ?? "Could not reset the password.");
    else setDone(true);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <div className="space-y-1.5">
        <Label htmlFor="password">New password (12+ characters)</Label>
        <Input id="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || password.length < 12}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
