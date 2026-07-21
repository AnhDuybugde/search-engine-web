"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  FileSearch,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export function LoginForm() {
  const router = useRouter();
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
        console.warn(data.warning);
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-brand" aria-hidden={false}>
        <div>
          <Logo className="h-11 w-11" inverted showWordmark />
          <h1>AI research workspace for datasets & the web</h1>
          <p>
            Upload documents, run hybrid retrieval, and get cited answers — or
            chat multi-turn against live web search with session memory.
          </p>
          <div className="auth-points">
            <div className="auth-point">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
              <div>
                <strong>Dataset Search</strong>
                <span>
                  Store raw sources, rank full text at query time, inspect
                  evidence and pipeline metrics.
                </span>
              </div>
            </div>
            <div className="auth-point">
              <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
              <div>
                <strong>Web Search sessions</strong>
                <span>
                  Multi-turn research with query expansion, citations, and
                  pipeline logs.
                </span>
              </div>
            </div>
            <div className="auth-point">
              <Quote className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div>
                <strong>Cited answers</strong>
                <span>
                  BM25 / hybrid RRF retrieval with transparent timing and
                  sources.
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-[#7a8ba3]">
          Free-tier serverless stack · passwords hashed with scrypt
        </p>
      </section>

      <div className="auth-form-wrap">
        <div className="auth-card">
          <div className="mb-6 flex flex-col items-start gap-2 sm:items-center sm:text-center">
            <div className="sm:hidden">
              <Logo className="h-9 w-9" showWordmark />
            </div>
            <h2
              className="text-xl font-semibold tracking-tight text-[var(--fg)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
              {mode === "login"
                ? "Sign in to open datasets and web research sessions."
                : "Register to keep notebooks and chat history on your account."}
            </p>
          </div>

          <div
            className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-1"
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
                  "rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
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
              <p className="alert alert-error" role="alert">
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

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--fg-muted)]">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
            <span>
              Your password is stored hashed (scrypt). Sessions use an HTTP-only
              cookie after sign-in.
            </span>
          </div>

          <p className="mt-5 text-center text-xs text-[var(--fg-subtle)]">
            {mode === "login" ? (
              <>
                No account?{" "}
                <button
                  type="button"
                  className="font-semibold text-[var(--accent)] hover:underline"
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
                  className="font-semibold text-[var(--accent)] hover:underline"
                  onClick={() => setMode("login")}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
