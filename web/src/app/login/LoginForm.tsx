"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/notebooks";
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url =
        mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : {
              email,
              password,
              displayName: displayName.trim() || undefined,
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { displayName?: string };
        warning?: string;
        ephemeral?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || `${mode} failed (${res.status})`);
      }
      if (data.warning) {
        // Soft notice — still signed in via cookie
        console.warn(data.warning);
      }
      router.replace(next.startsWith("/") ? next : "/notebooks");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg-base)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-10 w-10" showWordmark />
          <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-[var(--fg-muted)]">
            {mode === "login"
              ? "Sign in with your email to access Dataset Search and notebooks."
              : "Register a personal account. Your password is stored hashed (scrypt)."}
          </p>
        </div>

        <div
          className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
          role="tablist"
          aria-label="Auth mode"
        >
          {(
            [
              ["login", "Sign in"],
              ["register", "Register"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                mode === id
                  ? "bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm ring-1 ring-[var(--border)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
              onClick={() => {
                setMode(id);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          {mode === "register" && (
            <label className="block text-sm font-medium text-[var(--fg)]">
              Display name
              <input
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
                className="field mt-1.5"
              />
            </label>
          )}
          <label className="block text-sm font-medium text-[var(--fg)]">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field mt-1.5"
              required
            />
          </label>
          <label className="block text-sm font-medium text-[var(--fg)]">
            Password
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field mt-1.5"
              minLength={mode === "register" ? 8 : 1}
              required
            />
            {mode === "register" && (
              <span className="mt-1 block text-[11px] font-normal text-[var(--fg-subtle)]">
                At least 8 characters
              </span>
            )}
          </label>

          {error && (
            <p
              className="rounded-lg border border-rose-500/25 bg-rose-50 px-3 py-2 text-sm text-rose-800"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-primary w-full !min-h-11"
          >
            {loading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--fg-subtle)]">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                type="button"
                className="font-medium text-[var(--primary)] hover:underline"
                onClick={() => setMode("register")}
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button
                type="button"
                className="font-medium text-[var(--primary)] hover:underline"
                onClick={() => setMode("login")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
