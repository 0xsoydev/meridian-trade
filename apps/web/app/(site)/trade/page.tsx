import { Trade } from "./terminal";

const DEMO_MODEL = "glm-5.3";

export default async function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  return <Trade initialModel={model ?? DEMO_MODEL} />;
}
