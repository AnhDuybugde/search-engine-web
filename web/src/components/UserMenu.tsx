"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, Settings, User } from "lucide-react";
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
  variant?: "header" | "rail" | "sidebar";
}) {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

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

  async function saveDisplayName() {
    const displayName = nameDraft.trim();
    if (!displayName || savingName) return;
    setSavingName(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as { user?: MeUser; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error || "Update failed");
      setUser(data.user);
      setEditingName(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingName(false);
    }
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

  if (variant === "sidebar") {
    if (loading) {
      return <span className="text-xs text-[var(--fg-subtle)]">…</span>;
    }

    if (!user) {
      return (
        <a href="/login" className="btn-ghost !min-h-8 !px-2 text-xs">
          <LogIn className="h-3.5 w-3.5" aria-hidden />
          Sign in
        </a>
      );
    }

    const initials = (user.displayName || user.email || "U")
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return (
      <div className="user-menu-sidebar">
        <span className="user-menu-avatar" aria-hidden>
          {initials || <User className="h-3.5 w-3.5" />}
          <span className="user-menu-online" />
        </span>
        <span className="user-menu-identity">
          <span className="user-menu-name">{user.displayName || user.email}</span>
          <span className="user-menu-email">{user.email}</span>
        </span>
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          className="user-menu-settings"
          aria-label="Account settings"
          aria-expanded={settingsOpen}
          title="Account settings"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </button>
        {settingsOpen && (
          <div className="user-menu-popover">
            <div className="user-menu-popover-head">
              <span className="user-menu-popover-avatar">{initials}</span>
              <span className="min-w-0">
                <p className="truncate text-xs font-semibold text-[var(--fg)]">{user.displayName || "User"}</p>
                <p className="truncate text-[11px] text-[var(--fg-subtle)]">{user.email}</p>
              </span>
            </div>
            {editingName ? (
              <form
                className="space-y-2 border-b border-[var(--border)] px-1 py-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDisplayName();
                }}
              >
                <label className="block text-[11px] font-medium text-[var(--fg-muted)]">
                  Display name
                  <input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    className="field mt-1 !min-h-8 !px-2 !py-1 !text-xs"
                    maxLength={80}
                    autoFocus
                  />
                </label>
                {profileError && <p className="text-[11px] text-[var(--danger)]">{profileError}</p>}
                <div className="flex justify-end gap-1">
                  <button type="button" className="btn-ghost !min-h-7 !px-2 !text-[11px]" onClick={() => setEditingName(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary !min-h-7 !px-2 !text-[11px]" disabled={savingName || !nameDraft.trim()}>
                    {savingName ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNameDraft(user.displayName);
                  setProfileError(null);
                  setEditingName(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
              >
                <User className="h-3.5 w-3.5" aria-hidden />
                Edit profile
              </button>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Sign out
            </button>
          </div>
        )}
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
