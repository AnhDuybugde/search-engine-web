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

/** Derive https://PROJECT.supabase.co from db.PROJECT.supabase.co connection string */
export function deriveSupabaseUrl(
  databaseUrl?: string | null,
  explicit?: string | null,
): string | undefined {
  if (explicit?.trim()) return explicit.trim().replace(/\/$/, "");
  if (!databaseUrl) return undefined;
  const m = databaseUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  if (m) return `https://${m[1]}.supabase.co`;
  const m2 = databaseUrl.match(/@([a-z0-9-]+)\.pooler\.supabase\.com/i);
  // pooler host does not include project ref the same way — require explicit URL
  if (m2) return undefined;
  return undefined;
}

const envSchema = z.object({
  LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("llama-3.1-8b-instant"),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLIC_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  hasLlm: boolean;
  hasSearch: boolean;
  hasDb: boolean;
  supabaseUrl?: string;
};

function readRawEnv() {
  const DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);
  const SUPABASE_URL = deriveSupabaseUrl(
    DATABASE_URL,
    process.env.SUPABASE_URL,
  );
  return {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    BRAVE_API_KEY: process.env.BRAVE_API_KEY,
    DATABASE_URL,
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY: process.env.SUPABASE_PUBLIC_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    APP_PASSWORD: process.env.APP_PASSWORD,
  };
}

export function getConfig(): AppConfig {
  const raw = readRawEnv();
  const parsed = envSchema.safeParse(raw);

  const data = parsed.success
    ? parsed.data
    : {
        LLM_BASE_URL: raw.LLM_BASE_URL || "https://api.groq.com/openai/v1",
        LLM_API_KEY: raw.LLM_API_KEY,
        LLM_MODEL: raw.LLM_MODEL || "llama-3.1-8b-instant",
        TAVILY_API_KEY: raw.TAVILY_API_KEY,
        BRAVE_API_KEY: raw.BRAVE_API_KEY,
        DATABASE_URL: raw.DATABASE_URL,
        SUPABASE_URL: raw.SUPABASE_URL,
        SUPABASE_PUBLIC_KEY: raw.SUPABASE_PUBLIC_KEY,
        SUPABASE_SECRET_KEY: raw.SUPABASE_SECRET_KEY,
        APP_PASSWORD: raw.APP_PASSWORD,
      };

  const supabaseUrl =
    data.SUPABASE_URL ||
    deriveSupabaseUrl(data.DATABASE_URL, process.env.SUPABASE_URL);

  // Prefer Supabase REST (works on Vercel). Fall back to memory if neither REST nor SQL.
  const hasSupabaseRest = Boolean(supabaseUrl && data.SUPABASE_SECRET_KEY);
  const hasSql = Boolean(data.DATABASE_URL);

  return {
    ...data,
    supabaseUrl,
    hasLlm: Boolean(data.LLM_API_KEY),
    hasSearch: Boolean(data.TAVILY_API_KEY || data.BRAVE_API_KEY),
    hasDb: hasSupabaseRest || hasSql,
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
