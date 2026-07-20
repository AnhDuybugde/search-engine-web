"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";

type MeUser = {
  id: string;
  email: string;
  displayName: string;
};

export function UserMenu() {
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

  if (loading) {
    return (
      <span className="hidden text-xs text-[var(--fg-subtle)] sm:inline">
        …
      </span>
    );
  }

  if (!user) {
    return (
      <a
        href="/login"
        className="btn-ghost !min-h-8 text-xs"
      >
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[10rem] items-center gap-1.5 truncate text-xs text-[var(--fg-muted)] sm:inline-flex">
        <User className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" aria-hidden />
        <span className="truncate font-medium text-[var(--fg)]">
          {user.displayName}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="btn-ghost !min-h-8 !px-2 text-xs"
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
