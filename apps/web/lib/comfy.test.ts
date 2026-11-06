import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { GET, PUT } from "../app/api/v1/agents/comfy/route.ts";
import { db } from "./db.ts";
import { keys } from "./schema.ts";
import { cleanup, jsonRequest, makeKey, skip, suffix } from "./testkit.ts";

const URL = "http://localhost/api/v1/agents/comfy";

after(async () => {
  if (!skip) await cleanup();
});

test("a comfy agent connects only once its key has a verified human", { skip }, async () => {
  const key = await makeKey(1_000_000n);
  const agent = `yoyo-${suffix}`;

  const unverified = await PUT(jsonRequest(URL, key.raw, { agent }, "PUT"));
  assert.equal(unverified.status, 403);

  await db().update(keys).set({ worldSub: `test-${suffix}` }).where(eq(keys.id, key.id));

  const bad = await PUT(jsonRequest(URL, key.raw, { agent: "<script>" }, "PUT"));
  assert.equal(bad.status, 400);

  const connected = await PUT(jsonRequest(URL, key.raw, { agent }, "PUT"));
  assert.equal(connected.status, 200);
  const renamed = await PUT(jsonRequest(URL, key.raw, { agent: `${agent}-2` }, "PUT"));
  assert.equal(renamed.status, 200);

  const listed = (await (await GET()).json()) as { data: Array<{ agent: string; requests: number; spent_usd_micro: string }> };
  const mine = listed.data.filter((row) => row.agent.startsWith(agent));
  assert.deepEqual(mine, [{ ...mine[0], agent: `${agent}-2`, requests: 0, spent_usd_micro: "0" }]);

  const anonymous = await PUT(jsonRequest(URL, null, { agent }, "PUT"));
  assert.equal(anonymous.status, 401);
});
