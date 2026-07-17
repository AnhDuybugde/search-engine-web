"use client";

import { use } from "react";
import { SearchChatLayout } from "@/components/search/SearchChatLayout";

export default function SearchSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return <SearchChatLayout sessionId={sessionId} />;
}
