"use client";

import { useParams } from "next/navigation";
import { DatasetChatLayout } from "@/components/dataset/DatasetChatLayout";

export default function NotebookDetailPage() {
  const params = useParams<{ id: string }>();
  return <DatasetChatLayout notebookId={params.id} />;
}
