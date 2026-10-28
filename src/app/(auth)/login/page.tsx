"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.status === 403 || error.status === 401 ? "Email or password is incorrect, or the account is disabled." : (error.message ?? "Sign-in failed."));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || !email || !password}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="underline-offset-2 hover:underline">
          Forgot password?
        </Link>
        <span>Access is by invitation.</span>
      </div>
    </form>
  );
}
