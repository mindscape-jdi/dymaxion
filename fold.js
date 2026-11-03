// Geometry for folding Fuller's projection net into an icosahedron and then a
// sphere. Pure maths: no DOM or WebGL, so it can be tested in Node.
//
// d3-geo-polygon's Airocean projection is built from 24 flat pieces (the 20
// icosahedron faces, three of them cut so landmasses stay whole) joined in a
// tree. Each child piece hangs off its parent along a shared edge. Folding is
// a rotation about that hinge by the icosahedron's fold angle (π − dihedral),
// or 0° where both pieces are halves of the same face.

import { lonLatToVec } from "./sun.js";

const FOLD_ANGLE = Math.PI - Math.acos(-Math.sqrt(5) / 3); // ≈ 41.81°

// --- tiny vector / 4x4 (row-major) helpers ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(...a));

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
function apply(m, p) {
  return [0, 1, 2].map((i) => m[i * 4] * p[0] + m[i * 4 + 1] * p[1] + m[i * 4 + 2] * p[2] + m[i * 4 + 3]);
}
function translation(t) {
  return [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2], 0, 0, 0, 1];
}
// Rotation by `angle` about the line through `p` with unit direction `u`.
function hinge(p, u, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const [x, y, z] = u;
  const r = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
  return mul(translation(p), mul(r, translation(scale(p, -1))));
}
// Rigid transform taking triangle (a0, a1, a2) onto congruent triangle (b0, b1, b2).
function triangleToTriangle(a, b) {
  const frame = ([p0, p1, p2]) => {
    const e1 = norm(sub(p1, p0));
    const e3 = norm(cross(sub(p1, p0), sub(p2, p0)));
    return [e1, cross(e3, e1), e3];
  };
  const fa = frame(a), fb = frame(b);
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => fb[0][i] * fa[0][j] + fb[1][i] * fa[1][j] + fb[2][i] * fa[2][j]));
  const ra = [0, 1, 2].map((i) => dot(r[i], a[0]));
  const t = sub(b[0], ra);
  return [...r[0], t[0], ...r[1], t[1], ...r[2], t[2], 0, 0, 0, 1];
}

export function toColumnMajor(m) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[j * 4 + i] = m[i * 4 + j];
  return out;
}

// Build the net. `projection` is a d3.geoAirocean() instance (any scale).
// Returns flat coordinates in "net units", where a face edge has the same
// length as an edge of the icosahedron inscribed in the unit sphere.
export function buildNet(d3, projection, subdivisions = 12) {
  const rotation = d3.geoRotation(projection.rotate());
  const geo = (raw) => rotation.invert(raw); // projection-internal → geographic
  const vec = (raw) => lonLatToVec(...geo(raw));
  const toLonLat = (v) => {
    const r = norm(v);
    return [Math.atan2(r[1], r[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, r[2]))) * 180 / Math.PI];
  };

  // Walk the tree to learn each piece's parent and hinge.
  const nodes = [];
  (function walk(node, parent) {
    nodes.push({ node, parent });
    (node.children || []).forEach((c) => walk(c, node));
  })(projection.tree(), null);
  const index = new Map(nodes.map((n, i) => [n.node, i]));

  // Planar geometry of each piece, in Earth-fixed coordinates.
  const pieces = nodes.map(({ node, parent }) => {
    const n = vec(node.face.centroid);
    const units = node.face.map(vec);
    const h = Math.min(...units.map((u) => dot(n, u)));
    const corners = units.map((u) => scale(u, h / dot(n, u))); // on the face plane
    const center = scale(add(add(corners[0], corners[1]), corners[2]), 1 / 3);
    return { node, parentIndex: parent ? index.get(parent) : -1, corners, center, face: node.face.centroid };
  });

  // Flat position of a 3D face-plane point, nudged into its own piece so the
  // projection can't pick a neighbouring piece for points on an edge.
  const flatRaw = (p, piece) => projection(toLonLat(add(scale(p, 1 - 1e-6), scale(piece.center, 1e-6))));
  const raw0 = pieces[0].corners.map((c) => flatRaw(c, pieces[0]));
  const edge = Math.hypot(raw0[1][0] - raw0[0][0], raw0[1][1] - raw0[0][1]);
  const unit = edge / Math.hypot(...sub(pieces[0].corners[1], pieces[0].corners[0]));
  const [x0, x1, y0, y1] = (() => {
    const b = d3.geoPath(projection).bounds({ type: "Sphere" });
    return [b[0][0], b[1][0], b[0][1], b[1][1]];
  })();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const flat = (p, piece) => {
    const [x, y] = flatRaw(p, piece);
    return [(x - cx) / unit, -(y - cy) / unit, 0];
  };

  // Hinges.
  pieces.forEach((piece) => {
    piece.flatCorners = piece.corners.map((c) => flat(c, piece));
    if (piece.parentIndex < 0) return;
    const parent = pieces[piece.parentIndex];
    const shared = piece.node.shared.map((raw) => {
      const v = vec(raw);
      const n = vec(piece.face);
      const h = Math.min(...piece.node.face.map((c) => dot(n, vec(c))));
      return flat(scale(v, h / dot(n, v)), piece);
    });
    const u = norm(sub(shared[1], shared[0]));
    const flatCenter = scale(add(add(piece.flatCorners[0], piece.flatCorners[1]), piece.flatCorners[2]), 1 / 3);
    const side = cross(u, sub(flatCenter, shared[0]))[2];
    const sameFace = piece.face[0] === parent.face[0] && piece.face[1] === parent.face[1];
    piece.hinge = { point: shared[0], axis: u, angle: sameFace ? 0 : -Math.sign(side) * FOLD_ANGLE };
  });

  // Earth-fixed → net frame, from the root piece (which never moves).
  const root = pieces[0];
  const M = triangleToTriangle(root.corners, root.flatCorners);

  // Mesh: a barycentric grid on every piece.
  const N = subdivisions;
  const flatXY = [], dirs = [], icoScale = [], pieceIds = [], indices = [];
  pieces.forEach((piece, pi) => {
    const base = flatXY.length / 2;
    const rowStart = [];
    let k = 0;
    for (let i = 0; i <= N; i++) {
      rowStart.push(k);
      for (let j = 0; j <= N - i; j++, k++) {
        const a = 1 - (i + j) / N, b = i / N, c = j / N;
        const p = add(add(scale(piece.corners[0], a), scale(piece.corners[1], b)), scale(piece.corners[2], c));
        const f = flat(p, piece);
        const len = Math.hypot(...p);
        flatXY.push(f[0], f[1]);
        dirs.push(p[0] / len, p[1] / len, p[2] / len);
        icoScale.push(len);
        pieceIds.push(pi);
      }
    }
    const id = (i, j) => base + rowStart[i] + j;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N - i; j++) {
        indices.push(id(i, j), id(i + 1, j), id(i, j + 1));
        if (j < N - i - 1) indices.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
      }
    }
  });

  // Fold transforms for amount t (0 = flat net, 1 = closed icosahedron).
  function foldMatrices(t) {
    const out = [];
    pieces.forEach((piece, i) => {
      if (piece.parentIndex < 0) out[i] = IDENTITY;
      else {
        const { point, axis, angle } = piece.hinge;
        out[i] = mul(out[piece.parentIndex], hinge(point, axis, angle * t));
      }
    });
    return out;
  }

  return {
    pieces,
    M,
    foldMatrices,
    flatXY: new Float32Array(flatXY),
    dirs: new Float32Array(dirs),
    icoScale: new Float32Array(icoScale),
    pieceIds: new Float32Array(pieceIds),
    indices: new Uint32Array(indices),
    bounds: { width: (x1 - x0) / unit, height: (y1 - y0) / unit },
    apply,
  };
}
