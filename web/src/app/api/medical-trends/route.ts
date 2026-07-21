import { z } from "zod";

const EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const fallbackSuggestions = [
  "What are the latest advances in GLP-1 medications for obesity and type 2 diabetes?",
  "What is the current evidence for long COVID treatment and recovery?",
  "How is artificial intelligence being used in medical diagnosis?",
  "What are the latest findings on antimicrobial resistance in hospitals?",
  "How effective are mRNA vaccines against emerging respiratory viruses?",
  "What are the current clinical approaches to Alzheimer’s disease prevention?",
  "What does recent research show about gut microbiota and human health?",
  "How is liquid biopsy being used for early cancer detection?",
  "What are the latest treatments for treatment-resistant depression?",
  "How does sleep affect cardiovascular and metabolic health?",
  "What is the current evidence for personalized cancer immunotherapy?",
  "How are wearable devices being used for remote patient monitoring?",
  "What are the latest advances in gene therapy for rare diseases?",
  "What does current research show about precision medicine in oncology?",
  "How can clinical research improve the early diagnosis of sepsis?",
  "What are the latest evidence-based treatments for chronic pain?",
  "How does air pollution affect respiratory and cardiovascular disease?",
  "What are the current trends in regenerative medicine and tissue engineering?",
  "How is genomic sequencing changing infectious disease surveillance?",
  "What does recent medical research say about the health effects of climate change?",
];

const resultSchema = z.object({
  resultList: z.object({
    result: z.array(
      z.object({
        title: z.string().optional(),
      }),
    ).optional(),
  }).optional(),
});

function recentDate(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function toQuestion(title: string) {
  const clean = title.replace(/\s+/g, " ").trim().replace(/[.]$/, "");
  if (!clean || clean.length < 12) return null;
  const shortened = clean.length > 150 ? `${clean.slice(0, 147).trim()}…` : clean;
  return `What does recent medical research show about ${shortened}?`;
}

export async function GET() {
  const from = recentDate(365);
  const query = `FIRST_PDATE:[${from} TO NOW] AND TITLE_ABS:(clinical OR medicine OR medical OR healthcare OR patient OR disease OR treatment) NOT (plant OR crop OR wheat OR veterinary OR animal)`;
  const url = new URL(EUROPE_PMC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "40");
  url.searchParams.set("resultType", "lite");
  url.searchParams.set("sort", "CITED desc");

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4500),
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`Europe PMC returned ${response.status}`);
    const parsed = resultSchema.safeParse(await response.json());
    const titles = parsed.success
      ? (parsed.data.resultList?.result ?? [])
          .map((item) => item.title)
          .filter((title): title is string => Boolean(title))
          .map(toQuestion)
          .filter((item): item is string => Boolean(item))
      : [];
    const suggestions = [...new Set(titles)];
    return Response.json({
      suggestions: suggestions.length >= 4 ? suggestions.slice(0, 20) : fallbackSuggestions,
      source: suggestions.length >= 4 ? "europe-pmc" : "curated-fallback",
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json({
      suggestions: fallbackSuggestions,
      source: "curated-fallback",
      updatedAt: new Date().toISOString(),
    });
  }
}
