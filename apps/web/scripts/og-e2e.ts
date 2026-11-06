import assert from "node:assert/strict";
import { z } from "zod";
import { formatMicroPerMtok } from "../lib/price.ts";
import { catalog } from "../lib/rails.ts";

const MODEL = process.env.MODEL ?? "0gm-1.0-35b-a3b";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const rail = (await catalog()).find((candidate) => candidate.id === "0g");
const model = rail?.models.find((candidate) => candidate.canonical === MODEL);
assert.ok(rail && model, `0G does not list ${MODEL}`);
console.log(`catalog    ${MODEL} at ${formatMicroPerMtok(model.listPrompt)} / ${formatMicroPerMtok(model.listCompletion)} per MTok`);

const response = await fetch(`${rail.baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${required("OG_API_KEY")}`,
    "X-0G-Provider-Trust-Mode": "verified",
    "X-0G-Provider-Max-Price-Usd-Prompt": formatMicroPerMtok(model.listPrompt),
    "X-0G-Provider-Max-Price-Usd-Completion": formatMicroPerMtok(model.listCompletion),
  },
  body: JSON.stringify({ model: model.upstream, max_tokens: 512, messages: [{ role: "user", content: "Answer in one word: ready?" }] }),
});
if (!response.ok) throw new Error(`0G answered ${response.status}: ${await response.text()}`);
const completion = z
  .object({
    id: z.string().optional(),
    x_0g_trace: z.object({ request_id: z.string() }).optional(),
    choices: z
      .array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable() }) }))
      .min(1),
    usage: z.object({ total_tokens: z.number().int().positive() }),
  })
  .parse(await response.json());
const finish = completion.choices[0]?.finish_reason ?? "none";
const content = completion.choices[0]?.message.content?.trim() ?? "";
assert.ok(content, `0G answered with no content, finish_reason ${finish}`);
console.log(
  `inference  ${completion.usage.total_tokens} tokens, ${finish}, request ${completion.x_0g_trace?.request_id ?? completion.id ?? "unknown"}: ${content}`,
);
