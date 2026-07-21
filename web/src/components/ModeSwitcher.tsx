"use client";

import Link from "next/link";
import { Database, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ModeSwitcher({
  current,
}: {
  current: "dataset" | "web";
}) {
  return (
    <nav className="mode-switcher" aria-label="Research mode">
      <Link
        href="/notebooks"
        className={cn("mode-switcher-link", current === "dataset" && "is-active")}
        aria-current={current === "dataset" ? "page" : undefined}
        title="Switch to Dataset Search"
      >
        <Database className="h-4 w-4" aria-hidden />
        <span>Datasets</span>
      </Link>
      <Link
        href="/search"
        className={cn("mode-switcher-link", current === "web" && "is-active")}
        aria-current={current === "web" ? "page" : undefined}
        title="Switch to Web Search"
      >
        <Globe2 className="h-4 w-4" aria-hidden />
        <span>Web Search</span>
      </Link>
    </nav>
  );
}
