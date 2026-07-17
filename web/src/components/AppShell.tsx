"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";

const nav = [
  { href: "/search", label: "Web Search", icon: Search },
  { href: "/notebooks", label: "Notebooks", icon: BookOpen },
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
      <header className="sticky top-0 z-40 shrink-0 border-b border-white/10 bg-[#070b14]/55 backdrop-blur-2xl">
        <div
          className={cn(
            "mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6",
            wide || bare || fill ? "max-w-7xl" : "max-w-6xl",
          )}
        >
          <Link
            href="/search"
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <Logo className="h-10 w-10" showWordmark />
          </Link>

          <nav
            className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            aria-label="Primary"
          >
            {nav.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60",
                    active
                      ? "bg-gradient-to-b from-indigo-400/25 to-indigo-500/10 text-white shadow-sm ring-1 ring-indigo-300/30"
                      : "text-[var(--fg-muted)] hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main
        className={cn(
          fill
            ? "flex min-h-0 flex-1 flex-col"
            : cn(
                "mx-auto px-4 py-6 sm:px-6 sm:py-10",
                wide || bare ? "max-w-7xl" : "max-w-6xl",
              ),
        )}
      >
        {children}
      </main>
    </div>
  );
}
