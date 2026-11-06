import { asks } from "../../../../lib/book.ts";
import { blended, listCeiling, referenceFor } from "../../../../lib/price.ts";
import { catalog } from "../../../../lib/rails.ts";
import type { ModelRow, RailId, Verifiability } from "../../../../lib/types";

export async function GET(): Promise<Response> {
  const [rails, open] = await Promise.all([catalog(), asks(null)]);

  const seen = new Map<string, { rails: RailId[]; verifiability: Verifiability }>();
  for (const rail of rails) {
    for (const entry of rail.models) {
      const current = seen.get(entry.canonical) ?? { rails: [], verifiability: null };
      current.rails.push(rail.id);
      current.verifiability ??= entry.verifiability;
      seen.set(entry.canonical, current);
    }
  }

  const data: ModelRow[] = [];
  for (const [id, info] of seen) {
    const ref = referenceFor(id, rails);
    const ceiling = listCeiling(id, rails);
    if (!ref || ceiling === null) continue;
    const forModel = open.filter((ask) => ask.model === id);
    data.push({
      id,
      object: "model",
      rails: info.rails,
      verifiability: info.verifiability,
      list_prompt_micro_per_mtok: ref.pricing.prompt.toString(),
      list_completion_micro_per_mtok: ref.pricing.completion.toString(),
      reference_blended_micro_per_mtok: blended(ref.pricing).toString(),
      list_ceiling_micro_per_mtok: ceiling.toString(),
      best_ask_micro_per_mtok: forModel[0]?.price.toString() ?? null,
      index_micro_per_mtok: null,
      available_tokens: forModel.reduce((total, ask) => total + ask.tokensLeft, 0n).toString(),
    });
  }

  data.sort((a, b) => a.id.localeCompare(b.id));
  return Response.json({ object: "list", data });
}
