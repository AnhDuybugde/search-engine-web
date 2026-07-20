"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";

const nav = [
  { href: "/notebooks", label: "Dataset Search", icon: BookOpen },
  { href: "/search", label: "Web Search", icon: Search },
];

export function AppShell({
  children,
  wide = false,
  bare = false,
  /** Full-viewport chat layout: no main padding, fills below header */
  fill = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  /** Centered hero layout without side padding noise */
  bare?: boolean;
  fill?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "relative text-[var(--fg)]",
        fill ? "flex h-dvh flex-col overflow-hidden" : "min-h-dvh",
      )}
    >
      <header className="sticky top-0 z-40 shrink-0 border-b border-[var(--border)] bg-[var(--bg-base)]/85 backdrop-blur-xl">
        <div
          className={cn(
            "mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6",
            wide || bare || fill ? "max-w-[var(--content-max)]" : "max-w-5xl",
            fill && "max-w-none",
          )}
        >
          <Link
            href="/notebooks"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/60"
          >
            <Logo className="h-8 w-8" showWordmark />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <nav
              className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5"
              aria-label="Primary"
            >
              {nav.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname?.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/50",
                      active
                        ? "bg-[var(--primary-soft)] text-[var(--fg)] shadow-sm ring-1 ring-[var(--primary-border)]"
                        : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <UserMenu />
          </div>
        </div>
      </header>

      <main
        className={cn(
          fill
            ? "flex min-h-0 flex-1 flex-col"
            : cn(
                "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8",
                wide || bare ? "max-w-[var(--content-max)]" : "max-w-5xl",
              ),
        )}
      >
        {children}
      </main>
    </div>
  );
}
