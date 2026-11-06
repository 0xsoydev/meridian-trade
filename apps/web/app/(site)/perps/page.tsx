import type { Metadata } from "next";
import { Perps } from "./terminal";

const DEMO_MODEL = "0gm-1.0-35b-a3b";

export const metadata: Metadata = {
  title: "Perps — LLM Token Exchange",
};

export default async function PerpsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  return <Perps initialModel={model ?? DEMO_MODEL} />;
}
