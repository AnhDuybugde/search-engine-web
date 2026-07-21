/**
 * Lightweight multilingual retrieval bridge.
 *
 * Stored embeddings stay compatible with the existing English scientific
 * model. We keep the user's query intact and append only intent synonyms in
 * English, so lexical and dense retrieval can match English source text while
 * generation still receives the original question.
 */
const INTENT_BRIDGES: Array<{ terms: string[]; expansion: string }> = [
  {
    terms: [
      "cong thuc",
      "phuong trinh",
      "formula",
      "equation",
      "formulae",
      "formule",
      "fórmula",
      "formel",
    ],
    expansion: "formula equation mathematical expression calculation",
  },
  {
    terms: ["la gi", "what is", "qué es", "qu est ce", "was ist"],
    expansion: "definition meaning explanation",
  },
  {
    terms: ["cach", "how", "como", "comment", "wie"],
    expansion: "method procedure steps how it works",
  },
  {
    terms: ["so sanh", "compare", "comparison", "comparar", "comparer"],
    expansion: "comparison differences similarities benchmark",
  },
  {
    terms: ["uu diem", "loi ich", "advantages", "benefits", "ventajas"],
    expansion: "advantages benefits strengths improvements",
  },
  {
    terms: ["nhuoc diem", "han che", "disadvantages", "limitations", "limites"],
    expansion: "disadvantages limitations weaknesses drawbacks",
  },
  {
    terms: ["kien truc", "architecture", "arquitectura", "architecture"],
    expansion: "architecture components modules design structure",
  },
  {
    terms: ["huan luyen", "training", "entrenamiento", "entrainement"],
    expansion: "training optimization learning procedure dataset",
  },
  {
    terms: ["ket qua", "results", "resultados", "résultats", "ergebnisse"],
    expansion: "results performance evaluation metrics findings",
  },
  {
    terms: ["tai sao", "why", "por qué", "pourquoi", "warum"],
    expansion: "reason rationale cause explanation",
  },
];

function fold(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect requests that ask for source discovery rather than factual QA. */
export function isSourceDiscoveryQuery(query: string): boolean {
  const folded = fold(query);
  const findAction = /\b(tim|find|list|show|search|locate|tim kiem)\b/.test(
    folded,
  );
  const relevanceAction = /\b(lien quan|related|relevant)\b/.test(folded);
  const mentionsSources = /\b(tai lieu|bai bao|document|documents|source|sources|paper|papers|article|articles|dataset)\b/.test(
    folded,
  );
  return mentionsSources && (findAction || relevanceAction);
}

export function expandQueryForRetrieval(query: string) {
  const folded = fold(query);
  const expansions = INTENT_BRIDGES.filter(({ terms }) =>
    terms.some((term) => folded.includes(fold(term))),
  ).map(({ expansion }) => expansion);

  return expansions.length ? `${query.trim()} ${expansions.join(" ")}` : query.trim();
}

export function detectResponseLanguage(query: string) {
  const folded = fold(query);
  if (/[\u3040-\u30ff]/.test(query)) return "Japanese";
  if (/[\u4e00-\u9fff]/.test(query)) return "Chinese";
  if (/[\uac00-\ud7af]/.test(query)) return "Korean";
  if (/[\u0600-\u06ff]/.test(query)) return "Arabic";
  if (/[ăâđêôơư]|\b(la|cua|nhung|voi|khong|mot|cac|cho|tu|ve)\b/.test(fold(query))) {
    return "Vietnamese";
  }
  if (/\b(el|la|los|las|una|que|cómo|como|por|para|del)\b/.test(folded)) {
    return "Spanish";
  }
  if (/\b(le|la|les|une|des|que|pour|avec|dans|comment)\b/.test(folded)) {
    return "French";
  }
  if (/\b(der|die|das|ein|eine|und|für|wie|ist)\b/.test(folded)) {
    return "German";
  }
  return "the same language as the user's question";
}
