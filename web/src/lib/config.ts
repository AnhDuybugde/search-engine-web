import { z } from "zod";

/**
 * Supabase docs often show password as [YOUR-PASSWORD].
 * Strip accidental square brackets around the password segment.
 */
export function normalizeDatabaseUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/:\[([^\]]+)\]@/, ":$1@");
}

const envSchema = z.object({
  LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("llama-3.1-8b-instant"),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SUPABASE_PUBLIC_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  hasLlm: boolean;
  hasSearch: boolean;
  hasDb: boolean;
};

function readRawEnv() {
  return {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    BRAVE_API_KEY: process.env.BRAVE_API_KEY,
    DATABASE_URL: normalizeDatabaseUrl(process.env.DATABASE_URL),
    SUPABASE_PUBLIC_KEY: process.env.SUPABASE_PUBLIC_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    APP_PASSWORD: process.env.APP_PASSWORD,
  };
}

export function getConfig(): AppConfig {
  const raw = readRawEnv();
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const data = {
      LLM_BASE_URL: raw.LLM_BASE_URL || "https://api.groq.com/openai/v1",
      LLM_API_KEY: raw.LLM_API_KEY,
      LLM_MODEL: raw.LLM_MODEL || "llama-3.1-8b-instant",
      TAVILY_API_KEY: raw.TAVILY_API_KEY,
      BRAVE_API_KEY: raw.BRAVE_API_KEY,
      DATABASE_URL: raw.DATABASE_URL,
      SUPABASE_PUBLIC_KEY: raw.SUPABASE_PUBLIC_KEY,
      SUPABASE_SECRET_KEY: raw.SUPABASE_SECRET_KEY,
      APP_PASSWORD: raw.APP_PASSWORD,
    };
    return {
      ...data,
      hasLlm: Boolean(data.LLM_API_KEY),
      hasSearch: Boolean(data.TAVILY_API_KEY || data.BRAVE_API_KEY),
      hasDb: Boolean(data.DATABASE_URL),
    };
  }

  return {
    ...parsed.data,
    hasLlm: Boolean(parsed.data.LLM_API_KEY),
    hasSearch: Boolean(parsed.data.TAVILY_API_KEY || parsed.data.BRAVE_API_KEY),
    hasDb: Boolean(parsed.data.DATABASE_URL),
  };
}

export const IR_DEFAULTS = {
  chunkSizeWords: 280,
  chunkOverlapWords: 40,
  searchLimit: 6,
  retrieveTopK: 12,
  contextTopK: 4,
  maxOutputTokens: 600,
  temperature: 0.1,
  maxUploadBytes: 5 * 1024 * 1024,
  maxNotebookChars: 200_000,
  maxChunksPerNotebook: 500,
} as const;
