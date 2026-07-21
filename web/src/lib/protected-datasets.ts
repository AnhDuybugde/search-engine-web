const PROTECTED_DATASET_TITLES = new Set(["scidocs (raw)", "scifact (raw)"]);

export function isProtectedDatasetTitle(title: string): boolean {
  return PROTECTED_DATASET_TITLES.has(title.trim().toLowerCase().replace(/\s+/g, " "));
}
