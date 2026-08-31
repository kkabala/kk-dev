import assert from "node:assert/strict";
import test from "node:test";

import { productInfo } from "../src/index.ts";

test("the package identifies itself as the private Exoframe MVP", () => {
  assert.deepEqual(productInfo(), {
    name: "Exoframe",
    version: "0.0.0",
    private: true,
  });
});
