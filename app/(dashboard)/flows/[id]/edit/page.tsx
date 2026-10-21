"use client";

import { use } from "react";
import FlowBuilder from "@/components/flow-builder";

export default function EditFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <FlowBuilder mode="edit" flowId={id} />;
}
