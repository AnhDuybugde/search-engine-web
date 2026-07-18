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
  embeddingJson: jsonb("embedding_json"),
  embeddingModel: text("embedding_model"),
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

/** Multi-turn web search conversations */
export const searchSessions = pgTable("search_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: text("title").notNull().default("New chat"),
  summary: text("summary"),
  entitiesJson: jsonb("entities_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const searchMessages = pgTable("search_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sessionId: varchar("session_id", { length: 36 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  expandedQuery: text("expanded_query"),
  resultsJson: jsonb("results_json"),
  timingJson: jsonb("timing_json"),
  metricsJson: jsonb("metrics_json"),
  status: varchar("status", { length: 32 }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
