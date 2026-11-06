import type { Metadata } from "next";
import { Keys } from "./terminal";

export const metadata: Metadata = {
  title: "Keys — LLM Token Exchange",
};

export default function KeysPage() {
  return <Keys />;
}
