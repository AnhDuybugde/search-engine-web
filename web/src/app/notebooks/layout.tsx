"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { DatasetChatLayout } from "@/components/dataset/DatasetChatLayout";

/**
 * Keep the workspace shell mounted while switching between /notebooks and
 * /notebooks/[id]. Only the active dataset id changes, so the dataset list,
 * panel layout, and retrieval controls do not reset on every navigation.
 */
export default function NotebooksLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const segment = useSelectedLayoutSegment();

  // The page content is intentionally represented by DatasetChatLayout. The
  // child pages remain route entries for deep-linking and metadata ownership.
  void children;
  return <DatasetChatLayout notebookId={segment || null} />;
}
