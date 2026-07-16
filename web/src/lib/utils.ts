import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function nowMs() {
  return Date.now();
}

export function elapsed(start: number) {
  return Date.now() - start;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // drop common tracking params
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    for (const key of drop) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return raw;
  }
}
