import test from "node:test";
import assert from "node:assert/strict";
import { planetPosition, moonPosition, moonIllumination, starsToScene, sphereVec, applyMat } from "../sky.js";
import { earthToScene } from "../sun.js";

// Geocentric ecliptic longitude/latitude of date, computed with Astronomy Engine 2.1.19.
const REFERENCE = {"2000-01-01T12:00:00Z":{"Mercury":[271.889,-0.995],"Venus":[241.565,2.066],"Mars":[327.964,-1.068],"Jupiter":[25.254,-1.26],"Saturn":[40.396,-2.445],"Moon":[223.324,5.171]},"2024-06-20T00:00:00Z":{"Mercury":[95.653,1.59],"Venus":[93.361,0.539],"Mars":[37.974,-1.047],"Jupiter":[65.785,-0.702],"Saturn":[349.346,-1.938],"Moon":[244.004,-3.935]},"2026-11-02T20:00:00Z":{"Mercury":[224.473,-0.974],"Venus":[205.384,-4.42],"Mars":[139.539,1.639],"Jupiter":[144.542,0.696],"Saturn":[9.17,-2.68],"Moon":[142.941,0.353]},"2035-03-15T06:00:00Z":{"Mercury":[336.22,-2.209],"Venus":[317.218,-0.153],"Mars":[281.316,-0.42],"Jupiter":[19.15,-1.076],"Saturn":[118.637,0.458],"Moon":[63.376,-5.176]},"1990-08-01T00:00:00Z":{"Mercury":[153.568,0.099],"Venus":[104.297,-0.213],"Mars":[42.652,-2.023],"Jupiter":[116.235,0.257],"Saturn":[290.773,0.05],"Moon":[244.954,-4.681]}};

const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("planet and Moon positions match a full ephemeris to within 0.25°", () => {
  for (const [iso, bodies] of Object.entries(REFERENCE)) {
    for (const [name, [lon, lat]] of Object.entries(bodies)) {
      const p = name === "Moon" ? moonPosition(new Date(iso)) : planetPosition(name, new Date(iso));
      assert.ok(angle(p.lon, lon) < 0.25, `${iso} ${name} lon ${p.lon} vs ${lon}`);
      assert.ok(Math.abs(p.lat - lat) < 0.25, `${iso} ${name} lat ${p.lat} vs ${lat}`);
    }
  }
});

test("Moon distance and phase are sensible", () => {
  const d = moonPosition(new Date("2026-11-02T20:00:00Z")).dist;
  assert.ok(d > 55 && d < 64, `distance ${d} Earth radii`);
  // Full moon 2024-06-22 01:08 UTC, new moon 2024-07-05 22:57 UTC.
  assert.ok(moonIllumination(new Date("2024-06-22T01:08:00Z")) > 0.99);
  assert.ok(moonIllumination(new Date("2024-07-05T22:57:00Z")) < 0.01);
});

test("Polaris sits just off Earth's north pole in the globe scene", () => {
  for (const iso of ["2024-06-20T00:00:00Z", "2026-11-02T20:00:00Z"]) {
    const d = new Date(iso);
    const polaris = applyMat(starsToScene(d, -25), sphereVec(37.95, 89.264));
    const m = earthToScene(d, -25);
    const pole = [m[0][2], m[1][2], m[2][2]];
    const sep = Math.acos(polaris.reduce((s, v, i) => s + v * pole[i], 0)) * 180 / Math.PI;
    assert.ok(sep > 0.5 && sep < 0.9, `${iso}: Polaris ${sep.toFixed(2)}° from the pole`);
  }
});

import { observerFrame, altitudeOf } from "../sky.js";
import { subsolarPoint, sunAltitude } from "../sun.js";

test("observer view: Polaris stands at the observer's latitude", () => {
  for (const [lon, lat] of [[-74, 40.7], [139.7, 35.7], [-21.9, 64.1]]) {
    for (const iso of ["2026-11-03T02:00:00Z", "2026-11-03T09:00:00Z", "2027-05-01T18:30:00Z"]) {
      const d = new Date(iso);
      const f = observerFrame(d, lon, lat, -25, earthToScene);
      const polaris = applyMat(starsToScene(d, -25), sphereVec(37.95, 89.264));
      assert.ok(Math.abs(altitudeOf(f, polaris) - lat) < 1, `${lat}° ${iso}: Polaris at ${altitudeOf(f, polaris)}`);
    }
  }
});

test("observer view: sun altitude matches the map's formula", () => {
  const d = new Date("2026-11-03T15:00:00Z");
  const f = observerFrame(d, -74, 40.7, -25, earthToScene);
  const sunDir = [Math.cos(-25 * Math.PI / 180), 0, -Math.sin(-25 * Math.PI / 180)];
  const want = sunAltitude(subsolarPoint(d), -74, 40.7);
  assert.ok(Math.abs(altitudeOf(f, sunDir) - want) < 0.01, `${altitudeOf(f, sunDir)} vs ${want}`);
});

test("observer frame is right-handed: east × north = up", () => {
  const f = observerFrame(new Date(), 10, 50, -25, earthToScene);
  const [e, n, z] = [f.east, f.north, f.zenith];
  const c = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]];
  c.forEach((v, i) => assert.ok(Math.abs(v - z[i]) < 1e-9));
});
