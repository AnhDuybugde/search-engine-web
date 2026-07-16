import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Metrics, RankedChunk, Timing } from "@/lib/ir/types";
import { getDb, hasDb } from "./client";
import { searchRuns } from "./schema";
import { memRuns, type MemSearchRun } from "./memory";

export async function saveSearchRun(params: {
  query: string;
  results: RankedChunk[];
  answer: string;
  timing: Timing;
  metrics: Metrics;
}) {
  const id = randomUUID();
  const now = new Date();

  if (!hasDb()) {
    const row: MemSearchRun = {
      id,
      query: params.query,
      status: "completed",
      results: params.results,
      answer: params.answer,
      timing: params.timing,
      metrics: params.metrics,
      createdAt: now.toISOString(),
      completedAt: now.toISOString(),
    };
    memRuns.set(id, row);
    // keep last 50
    if (memRuns.size > 50) {
      const sorted = Array.from(memRuns.values()).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      for (const old of sorted.slice(0, memRuns.size - 50)) {
        memRuns.delete(old.id);
      }
    }
    return row;
  }

  const db = getDb();
  await db.insert(searchRuns).values({
    id,
    query: params.query,
    status: "completed",
    resultsJson: params.results,
    answer: params.answer,
    timingJson: params.timing,
    metricsJson: params.metrics,
    createdAt: now,
    completedAt: now,
  });

  return {
    id,
    query: params.query,
    status: "completed",
    results: params.results,
    answer: params.answer,
    timing: params.timing,
    metrics: params.metrics,
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
  };
}

export async function listSearchRuns(limit = 30) {
  if (!hasDb()) {
    return Array.from(memRuns.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        query: r.query,
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        hasAnswer: Boolean(r.answer),
      }));
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(searchRuns)
    .orderBy(desc(searchRuns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    query: r.query,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() || null,
    hasAnswer: Boolean(r.answer),
  }));
}

export async function getSearchRun(id: string) {
  if (!hasDb()) {
    return memRuns.get(id) || null;
  }
  const db = getDb();
  const rows = await db.select().from(searchRuns).where(eq(searchRuns.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    query: r.query,
    status: r.status,
    results: (r.resultsJson as RankedChunk[] | null) || null,
    answer: r.answer,
    timing: (r.timingJson as Timing | null) || null,
    metrics: (r.metricsJson as Metrics | null) || null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() || null,
  };
}

export async function deleteSearchRun(id: string) {
  if (!hasDb()) {
    memRuns.delete(id);
    return;
  }
  const db = getDb();
  await db.delete(searchRuns).where(eq(searchRuns.id, id));
}
