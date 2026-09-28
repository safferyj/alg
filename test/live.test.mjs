import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../alg.mjs";

test("generates a link from the live Artificial Analysis catalog", async () => {
  const stdout = [];
  const stderr = [];
  const result = await run([], {
    stdout: (...values) => stdout.push(values.join(" ")),
    stderr: (...values) => stderr.push(values.join(" ")),
  });

  assert.ok(result.selected.length > 0);
  assert.match(result.outputUrl, /^https:\/\/artificialanalysis\.ai\/\?models=/);
  assert.match(stderr.join("\n"), /Kept \d+ of \d+ requested models/);
  assert.equal(stdout.length, 1);
});
