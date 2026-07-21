"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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
      : pathname === "/"
        ? "home"
        : "dataset";

  return (
    <div
      className={cn("app-shell", fill && "app-shell--fill")}
      data-mood={mood}
    >
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
