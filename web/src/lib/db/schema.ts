import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const notebooks = pgTable("notebooks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sources = pgTable("sources", {
  id: varchar("id", { length: 36 }).primaryKey(),
  notebookId: varchar("notebook_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  mime: text("mime"),
  text: text("text").notNull(),
  blobUrl: text("blob_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chunks = pgTable("chunks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sourceId: varchar("source_id", { length: 36 }).notNull(),
  notebookId: varchar("notebook_id", { length: 36 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  tokenEst: integer("token_est"),
});

export const searchRuns = pgTable("search_runs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  query: text("query").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("completed"),
  resultsJson: jsonb("results_json"),
  answer: text("answer"),
  timingJson: jsonb("timing_json"),
  metricsJson: jsonb("metrics_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
