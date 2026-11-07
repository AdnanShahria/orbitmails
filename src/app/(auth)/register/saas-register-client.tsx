"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailPlus } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { clearClientSessionToken } from "@/lib/auth/client";

export function SaasRegisterClient() {
  const { t } = useLanguage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const turnstileToken = form.get("turnstileToken");

    if (!name) {
      setError("Please enter your name");
      setLoading(false);
      return;
    }
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          turnstileToken,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string | { fieldErrors?: Record<string, string[]> }; redirect?: string };

      if (!res.ok || !data.ok) {
        const errorMsg = typeof data.error === "string" 
          ? data.error 
          : "Registration failed. Please check your information.";
        setError(errorMsg);
        setTurnstileReset((v) => v + 1);
        setLoading(false);
        return;
      }

      clearClientSessionToken();
      router.replace(data.redirect || "/inbox");
      router.refresh();
    } catch (err) {
      setError("Network error occurred. Please try again.");
      setTurnstileReset((v) => v + 1);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      icon={MailPlus}
      title="Create OrbitMail Account"
      description="Connect any custom domain, open mail accounts, and dispatch high-throughput email through unified developer APIs."
    >
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            aria-invalid={error ? true : undefined}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={error ? true : undefined}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Minimum 8 characters"
            aria-invalid={error ? true : undefined}
            required
          />
        </div>

        {error && (
          <p
            id="register-error"
            role="alert"
            className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </p>
        )}

        <TurnstileField resetSignal={turnstileReset} />

        <Button
          type="submit"
          className="h-11 w-full rounded-full px-6 active:scale-[0.98] bg-blue-600 hover:bg-blue-700 text-white font-medium"
          disabled={loading}
        >
          {loading ? "Creating account..." : "Create Account"}
        </Button>

        <div className="pt-2 text-center text-sm text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

