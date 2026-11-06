import assert from "node:assert/strict";
import { test } from "node:test";
import { cheapestOf } from "./book.ts";

test("cheapestOf picks the first sorted ask whose model is on the shortlist", () => {
  const sorted = [{ model: "a" }, { model: "b" }, { model: "c" }];
  assert.equal(cheapestOf(sorted, ["c", "b"]), "b");
  assert.equal(cheapestOf(sorted, ["c"]), "c");
  assert.equal(cheapestOf(sorted, ["z"]), null);
  assert.equal(cheapestOf([], ["a"]), null);
});
