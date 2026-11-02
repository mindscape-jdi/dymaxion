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

// Returns the point on Earth where the sun is directly overhead, in degrees,
// plus the equation of time in minutes (apparent minus mean solar time).
export function subsolarPoint(date) {
  const n = julianDate(date) - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD; // obliquity of the ecliptic

  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG;

  // Greenwich mean sidereal time, in degrees.
  const gmst = 280.46061837 + 360.98564736629 * n;

  const lon = wrap180(ra - gmst);
  const eot = wrap180(L - ra) * 4; // minutes
  return { lat: dec, lon, eot };
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
