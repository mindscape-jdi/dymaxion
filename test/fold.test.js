import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildNet } from "../fold.js";

// Load the browser bundles the page uses into a sandbox.
const sandbox = {};
sandbox.globalThis = sandbox;
for (const f of ["d3.min.js", "d3-geo-projection.min.js", "d3-geo-polygon.min.js"]) {
  vm.runInNewContext(readFileSync(new URL(`../vendor/${f}`, import.meta.url), "utf8"), sandbox);
}
const d3 = sandbox.d3;
const net = buildNet(d3, d3.geoAirocean(), 6);

test("net has Fuller's 24 pieces in one tree", () => {
  assert.equal(net.pieces.length, 24);
  assert.equal(net.pieces.filter((p) => p.parentIndex < 0).length, 1);
});

test("flat pieces are the right size (equilateral, icosahedron edge)", () => {
  const edge = 4 / Math.sqrt(10 + 2 * Math.sqrt(5));
  const f = net.pieces[0].flatCorners;
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    assert.ok(Math.abs(Math.hypot(f[a][0] - f[b][0], f[a][1] - f[b][1]) - edge) < 1e-3);
  }
});

test("folding closes the net exactly into the icosahedron", () => {
  const F = net.foldMatrices(1);
  let worst = 0;
  net.pieces.forEach((p, i) => {
    p.flatCorners.forEach((fc, k) => {
      const folded = net.apply(F[i], fc);
      const target = net.apply(net.M, p.corners[k]);
      worst = Math.max(worst, Math.hypot(...folded.map((v, j) => v - target[j])));
    });
  });
  assert.ok(worst < 2e-3, `worst corner error ${worst}`);
});

test("unfolded net lies flat", () => {
  const F = net.foldMatrices(0);
  net.pieces.forEach((p, i) => p.flatCorners.forEach((fc) => assert.ok(Math.abs(net.apply(F[i], fc)[2]) < 1e-9)));
});

test("folded solid sits behind the flat net (map faces outward)", () => {
  const center = net.apply(net.M, [0, 0, 0]);
  assert.ok(center[2] < 0, `centre z ${center[2]}`);
});
