"use client";

import Link from "next/link";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (error) setError(error.message ?? "Could not request a reset. Try again.");
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">If an account exists for {email}, a reset link valid for one hour has been sent.</p>
        <Link href="/login" className="text-sm underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">Reset password</h1>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || !email}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="block text-center text-sm underline">
        Back to sign in
      </Link>
    </form>
  );
}
