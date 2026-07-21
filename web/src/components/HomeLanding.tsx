"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  FileSearch,
  Globe2,
  Layers,
  Quote,
  Sparkles,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

const MODULES = [
  {
    href: "/search",
    mood: "web" as const,
    icon: Globe2,
    badge: "Live web",
    title: "Web Search",
    description:
      "Multi-turn research against the open web. Expand follow-ups, retrieve evidence, and stream cited answers with session memory.",
    points: ["Tavily / Brave search", "Query expansion", "Cited answers"],
    cta: "Open Web Search",
  },
  {
    href: "/notebooks",
    mood: "dataset" as const,
    icon: BookOpen,
    badge: "Your corpus",
    title: "Document RAG",
    description:
      "Upload PDFs and notes, index embeddings, then ask over your datasets with hybrid BM25 + dense retrieval and grounded answers.",
    points: ["Upload & embed", "Adaptive / BM25", "Evidence panels"],
    cta: "Open Document RAG",
  },
] as const;

const CAPABILITIES = [
  { icon: Layers, label: "Hybrid IR", detail: "BM25 + Adaptive RRF" },
  { icon: FileSearch, label: "Evidence first", detail: "Ranked sources" },
  { icon: Quote, label: "Cited answers", detail: "Grounded LLM" },
  { icon: Zap, label: "Live pipelines", detail: "SSE progress" },
] as const;

export function HomeLanding() {
  return (
    <AppShell bare>
      <div className="home-landing anim-enter">
        <header className="home-topbar">
          <div className="home-topbar-inner">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Logo className="h-8 w-8" showWordmark />
            </Link>
            <nav className="home-topbar-nav" aria-label="Modules">
              <Link href="/search" className="home-topbar-link">
                Web Search
              </Link>
              <Link href="/notebooks" className="home-topbar-link">
                Document RAG
              </Link>
            </nav>
            <Link
              href="/search"
              className="btn-primary !min-h-9 !rounded-full !px-4 !text-sm"
            >
              Get started
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </header>

        <section className="home-hero">
          <div className="home-hero-glow home-hero-glow--violet" aria-hidden />
          <div className="home-hero-glow home-hero-glow--cyan" aria-hidden />
          <p className="home-kicker">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            AI research workspace
          </p>
          <h1 className="home-title">
            Search <span className="home-title-grad">Engine</span>
            <br />
            <span className="home-title-sub">two ways to find answers</span>
          </h1>
          <p className="home-lead">
            Choose live web research or document RAG over your own corpus.
            Hybrid retrieval, streaming answers, and evidence you can inspect.
          </p>
          <div className="home-hero-actions">
            <Link
              href="/search"
              className="btn-primary !min-h-11 !rounded-xl !px-5"
              data-mood="web"
            >
              <Globe2 className="h-4 w-4" aria-hidden />
              Web Search
            </Link>
            <Link
              href="/notebooks"
              className="btn-secondary !min-h-11 !rounded-xl !px-5"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              Document RAG
            </Link>
          </div>
        </section>

        <section className="home-modules anim-stagger" aria-label="Product modules">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link
                key={mod.href}
                href={mod.href}
                className={cn(
                  "home-module hover-lift",
                  mod.mood === "web"
                    ? "home-module--web"
                    : "home-module--dataset",
                )}
                data-mood={mod.mood}
              >
                <div className="home-module-head">
                  <span className="home-module-icon" aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="home-module-badge">{mod.badge}</span>
                </div>
                <h2>{mod.title}</h2>
                <p>{mod.description}</p>
                <ul className="home-module-points">
                  {mod.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
                <span className="home-module-cta">
                  {mod.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            );
          })}
        </section>

        <section className="home-caps" aria-label="Capabilities">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <div key={cap.label} className="home-cap">
                <span className="home-cap-icon" aria-hidden>
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <strong>{cap.label}</strong>
                  <span>{cap.detail}</span>
                </div>
              </div>
            );
          })}
        </section>

        <footer className="home-foot">
          <p>Serverless on Vercel · Postgres on Supabase · free-tier search & LLM keys</p>
        </footer>
      </div>
    </AppShell>
  );
}
