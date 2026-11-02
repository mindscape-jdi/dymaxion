// Speeds up d3.geoAirocean() several-fold. Its per-point face lookup uses
// d3.geoContains on each of 24 polygons; every piece is a spherical triangle,
// so three plane-side tests give the same answer far faster.
export function speedUpFaces(projection) {
  const R = Math.PI / 180;
  const v = ([lon, lat]) => [Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R)];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const face of projection.faces) {
    const c = face.face.map(v);
    const side = Math.sign(dot(cross(c[0], c[1]), c[2]));
    const n = [0, 1, 2].map((i) => cross(c[i], c[(i + 1) % 3]).map((x) => x * side));
    face.contains = (lambda, phi) => {
      const cp = Math.cos(phi);
      const p = [cp * Math.cos(lambda), cp * Math.sin(lambda), Math.sin(phi)];
      return dot(n[0], p) >= -1e-12 && dot(n[1], p) >= -1e-12 && dot(n[2], p) >= -1e-12;
    };
  }
  return projection;
}
