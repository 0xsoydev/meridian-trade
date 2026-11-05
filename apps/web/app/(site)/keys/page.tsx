import type { Metadata } from "next";
import { Keys } from "./terminal";

export const metadata: Metadata = {
  title: "Keys — LLM Token Exchange",
};

export default function KeysPage() {
  return <Keys privyReady={Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)} />;
}
