import test from "node:test";
import assert from "node:assert/strict";
import { subsolarPoint, sunAltitude, phaseOf } from "../sun.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

test("June solstice 2024: sun over the Tropic of Cancer", () => {
  const s = subsolarPoint(new Date("2024-06-20T20:51:00Z"));
  near(s.lat, 23.44, 0.02, "declination");
});

test("December solstice 2024: sun over the Tropic of Capricorn", () => {
  const s = subsolarPoint(new Date("2024-12-21T09:20:00Z"));
  near(s.lat, -23.44, 0.02, "declination");
});

test("March equinox 2024: sun over the equator", () => {
  const s = subsolarPoint(new Date("2024-03-20T03:06:00Z"));
  near(s.lat, 0, 0.02, "declination");
});

test("equation of time matches almanac values", () => {
  // Early November the sundial runs ~16.4 min fast; mid-February ~14.2 min slow.
  near(subsolarPoint(new Date("2024-11-03T12:00:00Z")).eot, 16.4, 0.3, "Nov 3");
  near(subsolarPoint(new Date("2024-02-11T12:00:00Z")).eot, -14.2, 0.3, "Feb 11");
});

test("subsolar longitude follows UTC and the equation of time", () => {
  const d = new Date("2024-11-03T12:00:00Z");
  const s = subsolarPoint(d);
  // At 12:00 UTC the sun is at Greenwich offset by the equation of time.
  near(s.lon, -s.eot / 4, 0.05, "longitude");
  near(s.lon, -4.1, 0.1, "longitude vs almanac");
});

test("altitude and phase", () => {
  const s = { lat: 10, lon: 20 };
  near(sunAltitude(s, 20, 10), 90, 1e-4, "zenith");
  near(sunAltitude(s, -160, -10), -90, 1e-4, "nadir");
  assert.equal(phaseOf(30), "day");
  assert.equal(phaseOf(-3), "civil twilight");
  assert.equal(phaseOf(-9), "nautical twilight");
  assert.equal(phaseOf(-15), "astronomical twilight");
  assert.equal(phaseOf(-40), "night");
});
