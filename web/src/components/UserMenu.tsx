"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";

type MeUser = {
  id: string;
  email: string;
  displayName: string;
};

export function UserMenu({
  variant = "header",
}: {
  /** `rail` = compact icon in dark app rail */
  variant?: "header" | "rail";
}) {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: MeUser | null };
        if (!cancelled) setUser(data.user || null);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (variant === "rail") {
    if (loading) {
      return (
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[10px] text-[var(--rail-fg-muted)]"
          aria-hidden
        >
          …
        </span>
      );
    }

    if (!user) {
      return (
        <a
          href="/login"
          className="app-rail-link"
          title="Sign in"
        >
          <LogIn className="h-[1.15rem] w-[1.15rem]" aria-hidden />
          <span>In</span>
        </a>
      );
    }

    const initials = (user.displayName || user.email || "?")
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return (
      <div className="flex w-full flex-col items-center gap-1">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--rail-active-bg)] text-[11px] font-bold text-white ring-1 ring-white/15"
          title={`${user.displayName} · ${user.email}`}
        >
          {initials || <User className="h-3.5 w-3.5" />}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="app-rail-link !min-h-0 !py-1.5"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          <span>Out</span>
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <span className="hidden text-xs text-[var(--fg-subtle)] sm:inline">
        …
      </span>
    );
  }

  if (!user) {
    return (
      <a href="/login" className="btn-ghost !min-h-9 text-xs">
        <LogIn className="h-3.5 w-3.5" aria-hidden />
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "hidden max-w-[10rem] items-center gap-1.5 truncate text-xs text-[var(--fg-muted)] sm:inline-flex",
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="truncate font-medium text-[var(--fg)]">
          {user.displayName}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="btn-ghost !min-h-9 !px-2 text-xs"
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
