export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  score?: number;
  scholarlyKind?: "journal" | "public-index" | "preprint" | "conference-paper";
};
