import assert from "node:assert/strict";
import { test } from "node:test";
import { byCheapest } from "./book.ts";

test("byCheapest orders the shortlist by best ask, then models with no asks", () => {
  const sorted = [{ model: "a" }, { model: "b" }, { model: "a" }, { model: "c" }];
  assert.deepEqual(byCheapest(sorted, ["c", "b"]), ["b", "c"]);
  assert.deepEqual(byCheapest(sorted, ["z", "c"]), ["c", "z"]);
  assert.deepEqual(byCheapest(sorted, ["a", "c", "b"]), ["a", "b", "c"]);
  assert.deepEqual(byCheapest([], ["x", "y"]), ["x", "y"]);
});
