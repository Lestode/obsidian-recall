import assert from "node:assert/strict";
import test from "node:test";
import { markerRoot, nearestRecallRoot } from "../src/roots";

test("derives a recall root from its marker", () => {
  assert.equal(markerRoot("Quant Research/_recall.md"), "Quant Research");
  assert.equal(markerRoot("_recall.md"), "");
  assert.equal(markerRoot("Quant Research/notes.md"), null);
});

test("finds the nearest recall root for a topic file", () => {
  const markers = ["Quant Research/_recall.md", "Quant Research/ML/_recall.md"];
  assert.equal(
    nearestRecallRoot("Quant Research/ML/Regression.md", markers),
    "Quant Research/ML",
  );
  assert.equal(nearestRecallRoot("Other/Regression.md", markers), null);
});
