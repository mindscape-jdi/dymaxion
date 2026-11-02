// Where the Moon, the naked-eye planets and the stars appear in the sky.
//
// Planets: JPL's Keplerian elements for approximate positions (E. M. Standish,
// valid 1800–2050, good to well under a degree as seen from Earth).
// Moon: the low-precision series from the Astronomical Almanac (~0.3°).
// Everything is returned in, or converted to, ecliptic coordinates of date,
// the same frame the sun and the globe use.

import { julianDate, sunAngles, mul3 } from "./sun.js";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// a (au), e, I, L, long. of perihelion, long. of ascending node (deg), then rates per century.
const ELEMENTS = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
    0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  Earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  Mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
};

// Display properties: typical brightness and colour.
export const PLANETS = [
  { name: "Mercury", color: "#c9c2b8", mag: 0 },
  { name: "Venus", color: "#fff4d6", mag: -4.2 },
  { name: "Mars", color: "#ff8a5c", mag: 0.5 },
  { name: "Jupiter", color: "#ffe9c4", mag: -2.4 },
  { name: "Saturn", color: "#f3d79a", mag: 0.6 },
];

const centuries = (date) => (julianDate(date) - 2451545) / 36525;

// Heliocentric ecliptic J2000 position (au).
function heliocentric(name, T) {
  const el = ELEMENTS[name];
  const [a, e, I, L, w, O] = el.slice(0, 6).map((v, i) => v + el[i + 6] * T);
  const omega = (w - O) * RAD;
  let M = ((((L - w) % 360) + 540) % 360 - 180) * RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [co, so, cO, sO, cI, sI] = [Math.cos(omega), Math.sin(omega), Math.cos(O * RAD), Math.sin(O * RAD), Math.cos(I * RAD), Math.sin(I * RAD)];
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

// General precession in longitude since J2000, degrees.
const precession = (T) => 1.396971 * T;

// Geocentric ecliptic longitude/latitude of date (degrees) and distance (au).
export function planetPosition(name, date) {
  const T = centuries(date);
  const p = heliocentric(name, T);
  const e = heliocentric("Earth", T);
  const g = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
  const dist = Math.hypot(...g);
  return {
    lon: (Math.atan2(g[1], g[0]) * DEG + precession(T) + 720) % 360,
    lat: Math.asin(g[2] / dist) * DEG,
    dist,
  };
}

// Moon: geocentric ecliptic longitude/latitude of date (degrees), distance in Earth radii.
export function moonPosition(date) {
  const T = centuries(date);
  const s = (a, b) => Math.sin((a + b * T) * RAD);
  const c = (a, b) => Math.cos((a + b * T) * RAD);
  const lon = 218.32 + 481267.881 * T
    + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22)
    + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89)
    - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const parallax = 0.9508 + 0.0518 * c(134.9, 477198.85) + 0.0095 * c(259.2, -413335.38)
    + 0.0078 * c(235.7, 890534.23) + 0.0028 * c(269.9, 954397.7);
  return { lon: ((lon % 360) + 360) % 360, lat, dist: 1 / Math.sin(parallax * RAD) };
}

// Illuminated fraction of the Moon (0 new, 1 full).
export function moonIllumination(date) {
  const m = moonPosition(date);
  const sun = sunAngles(date).lambda;
  const cosElong = Math.cos(m.lat * RAD) * Math.cos((m.lon - sun) * RAD);
  return (1 - cosElong) / 2;
}

// --- frames ---
const rz = (a) => {
  const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const rx = (a) => {
  const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const ry = (a) => {
  const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const AXES = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];

// Ecliptic-of-date vectors → the globe's scene frame (see earthToScene in sun.js).
export function eclipticToScene(date, sunAzimuth = 0) {
  return [ry(sunAzimuth), AXES, rz(-sunAngles(date).lambda)].reduce(mul3);
}

// Equatorial J2000 (star catalogue RA/Dec) → scene frame.
export function starsToScene(date, sunAzimuth = 0) {
  const T = centuries(date);
  return [eclipticToScene(date, sunAzimuth), rz(precession(T)), rx(-23.4392911)].reduce(mul3);
}

export function sphereVec(lonDeg, latDeg) {
  const l = lonDeg * RAD, p = latDeg * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

export function applyMat(m, v) {
  return m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
}
