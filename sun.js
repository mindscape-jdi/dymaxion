// Solar position math. Based on the low-precision formulas in the
// Astronomical Almanac (accurate to about 0.01° for 1950–2050), which is far
// finer than one pixel on the map.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function wrap180(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

// Orbital angles for `date`, in degrees: the sun's ecliptic longitude, the
// obliquity of the ecliptic, the sun's right ascension and declination, its
// mean longitude, and Greenwich mean sidereal time.
export function sunAngles(date) {
  const n = julianDate(date) - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g); // ecliptic longitude
  const eps = 23.439 - 0.0000004 * n; // obliquity of the ecliptic

  const lr = lambda * RAD;
  const er = eps * RAD;
  const ra = Math.atan2(Math.cos(er) * Math.sin(lr), Math.cos(lr)) * DEG;
  const dec = Math.asin(Math.sin(er) * Math.sin(lr)) * DEG;
  const gmst = 280.46061837 + 360.98564736629 * n; // Greenwich mean sidereal time
  return { lambda, eps, ra, dec, L, gmst };
}

// Returns the point on Earth where the sun is directly overhead, in degrees,
// plus the equation of time in minutes (apparent minus mean solar time).
export function subsolarPoint(date) {
  const { ra, dec, L, gmst } = sunAngles(date);
  return { lat: dec, lon: wrap180(ra - gmst), eot: wrap180(L - ra) * 4 };
}

// Sun altitude above the horizon (degrees) seen from [lon, lat].
export function sunAltitude(sub, lon, lat) {
  const p1 = lat * RAD;
  const p2 = sub.lat * RAD;
  const dl = (lon - sub.lon) * RAD;
  const cosZ = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) * DEG;
}

// Sunrise/sunset is when the sun's upper edge touches the horizon, with
// atmospheric refraction: altitude −0.833°.
export const HORIZON = -0.833;

export function phaseOf(altitude) {
  if (altitude > HORIZON) return "day";
  if (altitude > -6) return "civil twilight";
  if (altitude > -12) return "nautical twilight";
  if (altitude > -18) return "astronomical twilight";
  return "night";
}

// Rotation (row-major 3x3) taking Earth-fixed vectors (x toward 0°E on the
// equator, z toward the North Pole) into a scene frame where the sun lies in
// direction `sunDir` on the horizontal plane, "up" is the ecliptic north pole
// and the frame is right-handed with y up (as in three.js). Earth's axial tilt
// and daily spin are therefore shown as they really are relative to the sun.
export function earthToScene(date, sunAzimuth = 0) {
  const { lambda, eps, gmst } = sunAngles(date);
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
  // Ecliptic (x, y, z) to scene (x, z, -y): z (ecliptic north) becomes "up".
  const axes = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  return [ry(sunAzimuth), axes, rz(-lambda), rx(-eps), rz(gmst)].reduce(mul3);
}

export function mul3(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}

export function lonLatToVec(lon, lat) {
  const l = lon * RAD, p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
