"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AtSign, Eye, EyeOff, Globe2, MailPlus, Sparkles } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { clearClientSessionToken } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

interface SaasRegisterClientProps {
  availableDomains?: string[];
}

export function SaasRegisterClient({ availableDomains = ["orbitmails.com"] }: SaasRegisterClientProps) {
  const { t } = useLanguage();
  const router = useRouter();
  
  // Registration mode: "personal" (No domain needed) vs "custom" (Custom Domain / Developer)
  const [mode, setMode] = useState<"personal" | "custom">("personal");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [domain, setDomain] = useState(availableDomains[0] || "orbitmails.com");
  const [customEmail, setCustomEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9._-]/g, "");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name");
      setLoading(false);
      return;
    }

    if (mode === "personal") {
      if (!cleanUsername) {
        setError("Please choose your desired email username");
        setLoading(false);
        return;
      }
      if (cleanUsername.length < 2) {
        setError("Username must be at least 2 characters");
        setLoading(false);
        return;
      }
    } else {
      if (!customEmail || !customEmail.includes("@")) {
        setError("Please enter a valid work or personal email address");
        setLoading(false);
        return;
      }
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    const form = new FormData(e.currentTarget);
    const turnstileToken = form.get("turnstileToken");

    try {
      const payload = mode === "personal"
        ? {
            name: name.trim(),
            username: cleanUsername,
            domain,
            password,
            turnstileToken,
          }
        : {
            name: name.trim(),
            email: customEmail.trim().toLowerCase(),
            password,
            turnstileToken,
          };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { 
        ok?: boolean; 
        error?: string | { fieldErrors?: Record<string, string[]> }; 
        redirect?: string;
      };

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
      description={
        mode === "personal"
          ? "Get a free, private email address ready instantly. No custom domain required."
          : "Connect your own domain or generate API keys for automated email delivery."
      }
    >
      <div className="space-y-4">
        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 rounded-xl bg-neutral-100 p-1 text-xs font-semibold text-neutral-600">
          <button
            type="button"
            onClick={() => { setMode("personal"); setError(null); }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 transition-all",
              mode === "personal"
                ? "bg-white text-neutral-900 shadow-xs font-bold"
                : "text-neutral-500 hover:text-neutral-800"
            )}
          >
            <AtSign className="h-3.5 w-3.5 text-blue-600" />
            Personal Inbox
          </button>
          <button
            type="button"
            onClick={() => { setMode("custom"); setError(null); }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 transition-all",
              mode === "custom"
                ? "bg-white text-neutral-900 shadow-xs font-bold"
                : "text-neutral-500 hover:text-neutral-800"
            )}
          >
            <Globe2 className="h-3.5 w-3.5 text-blue-600" />
            Custom Domain
          </button>
        </div>

        <form method="post" onSubmit={onSubmit} className="space-y-4">
          {/* Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-semibold text-neutral-700">Full Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Alex Morgan"
              className="h-10 rounded-xl"
              required
            />
          </div>

          {/* Mode 1: Handle Picker for Personal Users */}
          {mode === "personal" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="username" className="text-xs font-semibold text-neutral-700">Choose Email Address</Label>
                <span className="text-[11px] font-medium text-blue-600">No domain needed</span>
              </div>
              <div className="flex items-center rounded-xl border border-neutral-200/90 bg-white shadow-xs focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all overflow-hidden">
                <input
                  id="username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                  autoComplete="username"
                  placeholder="username"
                  className="w-full bg-transparent px-3 py-2 text-sm font-medium text-neutral-900 placeholder:text-neutral-400 focus:outline-hidden"
                  required
                />
                <div className="border-l border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-600 shrink-0">
                  {availableDomains.length > 1 ? (
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="bg-transparent font-medium text-neutral-700 focus:outline-hidden cursor-pointer"
                    >
                      {availableDomains.map((d) => (
                        <option key={d} value={d}>
                          @{d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>@{availableDomains[0] || "orbitmails.com"}</span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-neutral-500">
                {cleanUsername ? (
                  <>Your inbox address will be <span className="font-semibold text-neutral-800">{cleanUsername}@{domain}</span></>
                ) : (
                  "Letters, numbers, dots, and hyphens supported."
                )}
              </p>
            </div>
          ) : (
            /* Mode 2: Existing Email for Custom Domain / Dev Users */
            <div className="space-y-1.5">
              <Label htmlFor="customEmail" className="text-xs font-semibold text-neutral-700">Work / Existing Email</Label>
              <Input
                id="customEmail"
                name="customEmail"
                type="email"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                className="h-10 rounded-xl"
                required
              />
              <p className="text-[11px] text-neutral-500">
                Sign in with this email, then connect your custom domain in Settings.
              </p>
            </div>
          )}

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-semibold text-neutral-700">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                className="h-10 rounded-xl pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 focus:outline-hidden"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Value props pill for normal users */}
          {mode === "personal" && (
            <div className="rounded-xl bg-blue-50/70 p-3 text-xs text-blue-900 border border-blue-100/60 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-blue-950">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                Instant Mailbox Ready
              </div>
              <p className="text-[11px] leading-relaxed text-blue-800/90">
                Your personal mailbox will be created automatically upon registration. You can start sending and receiving emails right away.
              </p>
            </div>
          )}

          {error && (
            <p
              id="register-error"
              role="alert"
              className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
            >
              {error}
            </p>
          )}

          <TurnstileField resetSignal={turnstileReset} />

          <Button
            type="submit"
            className="h-10 w-full rounded-full px-6 active:scale-[0.98] bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-xs"
            disabled={loading}
          >
            {loading 
              ? "Creating inbox..." 
              : mode === "personal" 
                ? "Create Free Inbox" 
                : "Create Developer Account"
            }
          </Button>

          <div className="pt-1 text-center text-xs text-neutral-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-blue-600 hover:underline">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
