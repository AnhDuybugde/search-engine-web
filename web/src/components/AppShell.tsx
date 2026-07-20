"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";

const nav = [
  {
    href: "/notebooks",
    label: "Dataset Search",
    short: "Data",
    icon: BookOpen,
    mood: "dataset" as const,
    match: (path: string) =>
      path === "/notebooks" || path.startsWith("/notebooks/"),
  },
  {
    href: "/search",
    label: "Web Search",
    short: "Web",
    icon: Search,
    mood: "web" as const,
    match: (path: string) => path === "/search" || path.startsWith("/search/"),
  },
];

export function AppShell({
  children,
  wide = false,
  bare = false,
  /** Full-viewport chat layout: fills remaining space beside rail */
  fill = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  bare?: boolean;
  fill?: boolean;
}) {
  const pathname = usePathname() || "";
  const mood =
    pathname === "/search" || pathname.startsWith("/search/")
      ? "web"
      : "dataset";

  return (
    <div
      className={cn("app-shell", fill && "app-shell--fill")}
      data-mood={mood}
    >
      <aside className="app-rail" aria-label="Primary">
        <Link
          href="/notebooks"
          className="app-rail-brand"
          title="SearchEngine home"
        >
          <Logo className="h-8 w-8" />
        </Link>

        <nav className="app-rail-nav" aria-label="Primary">
          {nav.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "app-rail-link",
                  active && "app-rail-link--active",
                )}
                aria-current={active ? "page" : undefined}
                title={item.label}
                data-mood={item.mood}
              >
                <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
                <span>{item.short}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-rail-footer">
          <UserMenu variant="rail" />
        </div>
      </aside>

      <div
        className={cn(
          "app-main",
          fill ? "app-main--fill" : "app-main--padded",
        )}
      >
        {fill ? (
          children
        ) : (
          <div
            className={cn(
              "app-main-inner anim-enter",
              wide || bare ? "app-main-inner--wide" : "app-main-inner--narrow",
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
