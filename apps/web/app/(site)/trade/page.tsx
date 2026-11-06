import { Trade } from "./terminal";

const DEMO_MODEL = "0gm-1.0-35b-a3b";

export default async function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  return <Trade initialModel={model ?? DEMO_MODEL} />;
}
