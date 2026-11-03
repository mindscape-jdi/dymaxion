import { subsolarPoint, sunAltitude, phaseOf, HORIZON } from "./sun.js";
import { speedUpFaces } from "./fastfaces.js";

const d3 = window.d3;
const topojson = window.topojson;
const SVG_NS = "http://www.w3.org/2000/svg";

// Major cities, with their IANA time zones so civil time is shown correctly.
const CITIES = [
  ["Honolulu", -157.86, 21.31, "Pacific/Honolulu"],
  ["Anchorage", -149.9, 61.22, "America/Anchorage"],
  ["Los Angeles", -118.24, 34.05, "America/Los_Angeles"],
  ["Mexico City", -99.13, 19.43, "America/Mexico_City"],
  ["New York", -74.01, 40.71, "America/New_York"],
  ["São Paulo", -46.63, -23.55, "America/Sao_Paulo"],
  ["Buenos Aires", -58.38, -34.6, "America/Argentina/Buenos_Aires"],
  ["Reykjavík", -21.94, 64.15, "Atlantic/Reykjavik"],
  ["London", -0.13, 51.51, "Europe/London"],
  ["Lagos", 3.38, 6.52, "Africa/Lagos"],
  ["Cairo", 31.24, 30.04, "Africa/Cairo"],
  ["Johannesburg", 28.05, -26.2, "Africa/Johannesburg"],
  ["Moscow", 37.62, 55.76, "Europe/Moscow"],
  ["Dubai", 55.27, 25.2, "Asia/Dubai"],
  ["Mumbai", 72.88, 19.08, "Asia/Kolkata"],
  ["Singapore", 103.82, 1.35, "Asia/Singapore"],
  ["Beijing", 116.4, 39.9, "Asia/Shanghai"],
  ["Tokyo", 139.69, 35.69, "Asia/Tokyo"],
  ["Sydney", 151.21, -33.87, "Australia/Sydney"],
  ["Auckland", 174.76, -36.85, "Pacific/Auckland"],
];

// Shading bands: each is the region where the sun is below `alt` degrees.
// Stacked translucent layers darken from twilight to full night.
const BANDS = [HORIZON, -6, -12, -18];
const BAND_OPACITY = 0.29;

// Colours shared by the map (CSS) and the globe texture.
const COLORS = {
  ocean: "#2b6c9e",
  land: "#c9b98a",
  landEdge: "#7d6f4a",
  rail: "#9e2f2a",
  ship: "#3ee6cf",
  flight: "#ff8fd8",
};

const $ = (id) => document.getElementById(id);
const els = {
  svg: $("map"),
  wrap: $("mapWrap"),
  globe: $("globe"),
  tooltip: $("tooltip"),
  localTime: $("localTime"),
  localDate: $("localDate"),
  tzName: $("tzName"),
  utcTime: $("utcTime"),
  badge: $("modeBadge"),
  facts: $("facts"),
  cityList: $("cityList"),
  jump: $("jump"),
  showCities: $("showCities"),
  showNoon: $("showNoon"),
  showGrid: $("showGrid"),
  showShip: $("showShip"),
  showFlights: $("showFlights"),
  showRail: $("showRail"),
  spin: $("spin"),
  showCons: $("showCons"),
  showPlanets: $("showPlanets"),
  skyLabels: $("skyLabels"),
  skyFrom: $("skyFrom"),
  spinLabel: $("spinLabel"),
  locate: $("locate"),
  globeBtn: $("globeBtn"),
  zoomIn: $("zoomIn"),
  zoomOut: $("zoomOut"),
  zoomReset: $("zoomReset"),
  loading: $("loading"),
};

// ---------- Time model ----------
// Displayed time = anchorSim + (realNow - anchorReal) * speed.
const clock = { anchorReal: Date.now(), anchorSim: Date.now(), speed: 1, live: true };

function simNow() {
  if (clock.live) return new Date();
  return new Date(clock.anchorSim + (Date.now() - clock.anchorReal) * clock.speed);
}

function setClock({ sim = simNow().getTime(), speed = clock.speed, live = false }) {
  clock.anchorReal = Date.now();
  clock.anchorSim = sim;
  clock.speed = speed;
  clock.live = live;
  els.badge.textContent = live ? "LIVE" : speed === 1 ? "CUSTOM TIME" : `×${speed.toLocaleString()}`;
  els.badge.classList.toggle("live", live);
  document.querySelectorAll(".seg button").forEach((b) => {
    const s = Number(b.dataset.speed);
    b.classList.toggle("on", live ? s === 1 : s === speed && speed !== 1);
  });
  drawDynamic(true);
}

// ---------- Map ----------
// The map is drawn once in a fixed virtual coordinate space and scaled by the
// SVG viewBox, so resizing and zooming never re-project the data.
const VW = 1000;
const PAD = 8;
const projection = speedUpFaces(d3.geoAirocean()).fitWidth(VW - 2 * PAD, { type: "Sphere" });
const path = d3.geoPath(projection);
const VH = (() => {
  const b = path.bounds({ type: "Sphere" });
  projection.translate([projection.translate()[0] + PAD - b[0][0], projection.translate()[1] + PAD - b[0][1]]);
  return Math.ceil(b[1][1] - b[0][1] + 2 * PAD);
})();

const data = { land: null, rail: null, ship: null, ports: null, flights: null, flightsBusy: null };
let me = null; // user's location, if shared
let zoomT = d3.zoomIdentity;
let markerScale = 1; // keeps markers a constant size on screen

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const layers = {};
function buildLayers() {
  const svg = els.svg;
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  els.wrap.style.setProperty("--map-aspect", `${VW} / ${VH}`);
  const defs = el("defs", {}, svg);
  const clip = el("clipPath", { id: "sphereClip" }, defs);
  layers.clipPath = el("path", {}, clip);
  const grad = el("radialGradient", { id: "sunGlow" }, defs);
  el("stop", { offset: "0%", "stop-color": "#fffbe6" }, grad);
  el("stop", { offset: "35%", "stop-color": "#ffd34d" }, grad);
  el("stop", { offset: "70%", "stop-color": "#ffb300", "stop-opacity": "0.35" }, grad);
  el("stop", { offset: "100%", "stop-color": "#ffb300", "stop-opacity": "0" }, grad);

  // Zoomable content.
  layers.zoom = el("g", {}, svg);
  layers.ocean = el("path", { class: "ocean" }, layers.zoom);
  const clipped = el("g", { "clip-path": "url(#sphereClip)" }, layers.zoom);
  layers.grid = el("path", { class: "graticule" }, clipped);
  layers.equator = el("path", { class: "equator" }, clipped);
  layers.land = el("path", { class: "land" }, clipped);
  layers.shade = BANDS.map(() => el("path", { class: "shade", "fill-opacity": BAND_OPACITY }, clipped));
  layers.terminator = el("path", { class: "terminator" }, clipped);
  layers.rail = el("path", { class: "rail" }, clipped);
  layers.ship = [1, 2, 3].map((k) => el("path", { class: `ship ship-${k}` }, clipped));
  layers.flights = el("path", { class: "flight" }, clipped);
  layers.flightsBusy = el("path", { class: "flight busy" }, clipped);
  layers.noonLine = el("path", { class: "noon-line" }, clipped);
  layers.outline = el("path", { class: "outline" }, layers.zoom);

  // Markers stay the same size while zooming; positioned in screen space.
  layers.markers = el("g", {}, svg);
  layers.ports = el("g", { class: "ports" }, layers.markers);
  layers.noonMarks = el("g", {}, layers.markers);
  layers.cities = el("g", {}, layers.markers);
  layers.me = el("g", { class: "me" }, layers.markers);
  layers.sun = el("g", { class: "sun" }, layers.markers);
  el("circle", { r: 16, fill: "url(#sunGlow)" }, layers.sun);
  el("circle", { r: 4.5, fill: "#fff6c8", stroke: "#ff9d00", "stroke-width": 1.2 }, layers.sun);

  layers.cityNodes = CITIES.map(([name]) => {
    const g = el("g", { class: "city" }, layers.cities);
    el("circle", { r: 3 }, g);
    const t = el("text", { dx: 5, dy: 3 }, g);
    t.textContent = name;
    return g;
  });
}

function drawStatic() {
  const sphere = path({ type: "Sphere" });
  layers.ocean.setAttribute("d", sphere);
  layers.outline.setAttribute("d", sphere);
  layers.clipPath.setAttribute("d", sphere);
  layers.grid.setAttribute("d", path(d3.geoGraticule10()));
  layers.equator.setAttribute("d", path({ type: "LineString", coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] }));
  applyToggles();
}

// Project heavy layers one at a time, yielding to the browser in between.
const idle = () => new Promise((r) => setTimeout(r, 0));
async function drawData(name) {
  await idle();
  if (name === "land") layers.land.setAttribute("d", path(data.land));
  if (name === "rail") layers.rail.setAttribute("d", path(data.rail));
  if (name === "ship") {
    data.ship.forEach((g, i) => layers.ship[i].setAttribute("d", path(g)));
    layers.ports.textContent = "";
    layers.portNodes = data.ports.map(([name, lon, lat]) => {
      const c = el("circle", { r: 2.2 }, layers.ports);
      c.dataset.p = JSON.stringify(projection([lon, lat]));
      el("title", {}, c).textContent = name;
      return c;
    });
    placeMarkers();
  }
  if (name === "flights") {
    layers.flights.setAttribute("d", path(data.flights));
    layers.flightsBusy.setAttribute("d", path(data.flightsBusy));
  }
}

function applyToggles() {
  const show = (node, on) => (node.style.display = on ? "" : "none");
  show(layers.grid, els.showGrid.checked);
  show(layers.equator, els.showGrid.checked);
  show(layers.rail, els.showRail.checked);
  layers.ship.forEach((n) => show(n, els.showShip.checked));
  show(layers.ports, els.showShip.checked);
  show(layers.flights, els.showFlights.checked);
  show(layers.flightsBusy, els.showFlights.checked);
  show(layers.cities, els.showCities.checked);
  show(layers.noonLine, els.showNoon.checked);
  show(layers.noonMarks, els.showNoon.checked);
  if (globe) globe.redrawTexture();
}

// Screen-space position of a projected point under the current zoom.
function place(node, p) {
  if (!p || !isFinite(p[0])) {
    node.style.display = "none";
    return;
  }
  const [x, y] = zoomT.apply(p);
  const off = x < -20 || y < -20 || x > VW + 20 || y > VH + 20;
  node.style.visibility = off ? "hidden" : "";
  node.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${markerScale.toFixed(3)})`);
}

const cityPoints = CITIES.map(([, lon, lat]) => projection([lon, lat]));
let sunPoint = null;
let noonPoints = [];
function placeMarkers() {
  layers.cityNodes.forEach((n, i) => place(n, cityPoints[i]));
  if (sunPoint) place(layers.sun, sunPoint);
  if (me) place(layers.me, me.p);
  (layers.portNodes || []).forEach((n) => place(n, JSON.parse(n.dataset.p)));
  [...layers.noonMarks.children].forEach((n, i) => place(n, noonPoints[i]));
}

// Region where the sun is below altitude `alt`: a spherical cap around the
// anti-solar point with radius 90° + alt.
function shadeCap(sub, alt) {
  const anti = [sub.lon + 180, -sub.lat];
  return d3.geoCircle().center(anti).radius(90 + alt).precision(0.5)();
}

let lastShadeKey = "";
function drawDynamic(force = false) {
  const now = simNow();
  const sub = subsolarPoint(now);

  // Only redraw the shading when the sun has moved enough to matter (~0.02°).
  const key = `${sub.lon.toFixed(2)},${sub.lat.toFixed(2)}`;
  if ((force || key !== lastShadeKey) && !els.wrap.classList.contains("globe-on")) {
    lastShadeKey = key;
    BANDS.forEach((alt, i) => layers.shade[i].setAttribute("d", path(shadeCap(sub, alt))));
    const term = shadeCap(sub, HORIZON);
    layers.terminator.setAttribute("d", path({ type: "LineString", coordinates: term.coordinates[0] }));
    sunPoint = projection([sub.lon, sub.lat]);
    drawNoonLine(now);
    CITIES.forEach(([, lon, lat], i) => {
      layers.cityNodes[i].setAttribute("class", `city ${bucket(sunAltitude(sub, lon, lat))}`);
    });
    placeMarkers();
  }
  renderClockText(now, sub);
}

function bucket(alt) {
  if (alt > HORIZON) return "day";
  if (alt > -6) return "twilight";
  return "night";
}

// The sun's ground track over the next 24 h, marked where it's solar noon at each UTC hour.
function drawNoonLine(now) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const coords = [];
  for (let m = -12 * 60; m <= 12 * 60; m += 10) {
    const s = subsolarPoint(new Date(now.getTime() + m * 60000));
    coords.push([s.lon, s.lat]);
  }
  // Split where longitude wraps so the line doesn't jump across the map.
  const lines = [[]];
  coords.forEach((c, i) => {
    if (i && Math.abs(c[0] - coords[i - 1][0]) > 180) lines.push([]);
    lines[lines.length - 1].push(c);
  });
  layers.noonLine.setAttribute("d", path({ type: "MultiLineString", coordinates: lines }));

  layers.noonMarks.textContent = "";
  noonPoints = [];
  for (let h = -11; h <= 12; h++) {
    const t = new Date(start.getTime() + h * 3600000);
    if (Math.abs(t - now) < 20 * 60000) continue; // the sun marker is here already
    const s = subsolarPoint(t);
    const p = projection([s.lon, s.lat]);
    if (!p || !isFinite(p[0])) continue;
    const g = el("g", {}, layers.noonMarks);
    el("circle", { r: 1.8, class: "noon-dot" }, g);
    const label = el("text", { class: "noon-label", y: -5, "text-anchor": "middle" }, g);
    label.textContent = String(t.getUTCHours()).padStart(2, "0");
    noonPoints.push(p);
  }
}

// ---------- Zoom ----------
const zoom = d3
  .zoom()
  .scaleExtent([1, 24])
  .extent([[0, 0], [VW, VH]])
  .translateExtent([[0, 0], [VW, VH]])
  // At full view let one-finger swipes scroll the page; pinch always zooms.
  .filter((e) => {
    if (e.type === "touchstart") return e.touches.length > 1 || zoomT.k > 1;
    return (!e.ctrlKey || e.type === "wheel") && !e.button;
  })
  .on("zoom", (e) => {
    zoomT = e.transform;
    layers.zoom.setAttribute("transform", zoomT.toString());
    els.wrap.classList.toggle("zoomed", zoomT.k > 1.01);
    placeMarkers();
    hover = null;
    els.tooltip.hidden = true;
  });

function zoomBy(k) {
  if (globeActive) return globe.zoomBy(k);
  d3.select(els.svg).transition().duration(300).call(zoom.scaleBy, k);
}
function zoomReset() {
  if (globeActive) return globe.resetView();
  d3.select(els.svg).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
}

// ---------- Text panels ----------
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmt = {
  time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  date: new Intl.DateTimeFormat(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
  utc: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" }),
  utcDate: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
};
const cityFmt = new Map();
function cityTime(tz, d) {
  if (!cityFmt.has(tz)) {
    cityFmt.set(tz, {
      time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz }),
      day: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: tz }),
    });
  }
  const f = cityFmt.get(tz);
  return { time: f.time.format(d), day: f.day.format(d) };
}

const latStr = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? "N" : "S"}`;
const lonStr = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? "E" : "W"}`;

function solarTime(d, lon, eot) {
  const minutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + lon * 4 + eot + 2880) % 1440;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function poleState(alt) {
  return alt > HORIZON ? "polar day" : alt > -6 ? "twilight" : "polar night";
}

let lastSecond = -1;
function renderClockText(now, sub) {
  const sec = Math.floor(now.getTime() / 1000);
  if (sec === lastSecond) return;
  lastSecond = sec;

  els.localTime.textContent = fmt.time.format(now);
  els.localDate.textContent = fmt.date.format(now);
  els.tzName.textContent = userTz;
  els.utcTime.textContent = `${fmt.utc.format(now)} ${fmt.utcDate.format(now)}`;

  const facts = [
    ["Sun overhead", `${latStr(sub.lat)}, ${lonStr(sub.lon)}`],
    ["Solar declination", `${sub.lat >= 0 ? "+" : ""}${sub.lat.toFixed(2)}°`],
    ["Equation of time", `${sub.eot >= 0 ? "+" : "−"}${Math.abs(sub.eot).toFixed(1)} min`],
    ["North Pole", poleState(sunAltitude(sub, 0, 90))],
    ["South Pole", poleState(sunAltitude(sub, 0, -90))],
  ];
  if (me) {
    const alt = sunAltitude(sub, me.lon, me.lat);
    facts.unshift(["At your location", `${phaseOf(alt)} · sun ${alt.toFixed(1)}°`]);
  }
  els.facts.innerHTML = facts
    .map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join("");

  els.cityList.innerHTML = CITIES.map(([name, lon, lat, tz]) => {
    const alt = sunAltitude(sub, lon, lat);
    const icon = alt > HORIZON ? "☀️" : alt > -6 ? "🌅" : "🌙";
    const t = cityTime(tz, now);
    return `<li class="${bucket(alt)}"><div class="city-name">${icon} ${name}</div>` +
      `<div class="city-time">${t.time}</div>` +
      `<div class="city-phase">${t.day} · ${phaseOf(alt)}</div></li>`;
  }).join("");

  if (hover && !globeActive) showTooltip(hover);
}

// ---------- Hover / tap inspector ----------
let hover = null;
function pointerToLonLat(evt) {
  const ctm = els.svg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
  const [x, y] = zoomT.invert([pt.x, pt.y]);
  const ll = projection.invert([x, y]);
  if (!ll || !isFinite(ll[0])) return null;
  // Reject points outside the unfolded net: re-projecting must land back on the cursor.
  const back = projection(ll);
  if (!back || Math.hypot(back[0] - x, back[1] - y) > 1) return null;
  const r = els.wrap.getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top, w: r.width, lon: ll[0], lat: ll[1] };
}

function showTooltip(h) {
  const now = simNow();
  const sub = subsolarPoint(now);
  const alt = sunAltitude(sub, h.lon, h.lat);
  const tt = els.tooltip;
  tt.hidden = false;
  tt.innerHTML =
    `<b>${latStr(h.lat)}, ${lonStr(h.lon)}</b><br>` +
    `Solar time ${solarTime(now, h.lon, sub.eot)}<br>` +
    `Sun ${alt.toFixed(1)}° · ${phaseOf(alt)}`;
  tt.style.left = `${Math.min(Math.max(h.x, 95), h.w - 95)}px`;
  tt.style.top = `${Math.max(h.y, 80)}px`;
}

els.svg.addEventListener("pointermove", (e) => {
  if (e.buttons) return; // dragging pans the map
  hover = pointerToLonLat(e);
  if (hover) showTooltip(hover);
  else els.tooltip.hidden = true;
});
els.svg.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") {
    hover = null;
    els.tooltip.hidden = true;
  }
});
els.svg.addEventListener("click", (e) => {
  hover = pointerToLonLat(e);
  if (hover) showTooltip(hover);
  else els.tooltip.hidden = true;
});

// ---------- Globe ----------
let globe = null;
let globeActive = false;
let globeBusy = false;

// Equirectangular texture of the base map and the data layers for the globe.
function drawTexture(canvas) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, k = W / 4096;
  const proj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2);
  const p = d3.geoPath(proj, ctx);
  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, W, H);
  const stroke = (geo, color, width, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    p(geo);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  if (els.showGrid.checked) stroke(d3.geoGraticule10(), "rgba(255,255,255,0.16)", 1.2);
  if (data.land) {
    ctx.fillStyle = COLORS.land;
    ctx.beginPath();
    p(data.land);
    ctx.fill();
    stroke(data.land, COLORS.landEdge, 1);
  }
  if (data.rail && els.showRail.checked) stroke(data.rail, COLORS.rail, 1.6, 0.9);
  if (data.ship && els.showShip.checked) data.ship.forEach((g, i) => stroke(g, COLORS.ship, [2, 3.5, 5.5][i], 0.9));
  if (data.flights && els.showFlights.checked) {
    stroke(data.flights, COLORS.flight, 1, 0.22);
    stroke(data.flightsBusy, COLORS.flight, 1.4, 0.45);
  }
}

async function toggleGlobe() {
  if (globeBusy) return;
  globeBusy = true;
  els.globeBtn.disabled = true;
  try {
    if (!globeActive) {
      if (!globe) {
        els.globeBtn.textContent = "Loading 3D…";
        const { createGlobe } = await import("./globe.js");
        globe = createGlobe({ canvas: els.globe, d3, getTime: simNow, drawTexture, labelLayer: els.skyLabels });
        globe.setAutoRotate(els.spin.checked);
        applySky();
        window.dymaxionGlobe = globe; // handy for debugging in the console
        getJSON("sky.json").then((sky) => globe.loadSky(sky)).catch((err) => console.error("Could not load sky", err));
      }
      globe.redrawTexture();
      zoomReset();
      els.wrap.classList.add("globe-on");
      hover = null;
      els.tooltip.hidden = true;
      globeActive = true;
      globe.start();
      globe.resize();
      els.globeBtn.textContent = "Folding…";
      await globe.fold();
      els.globeBtn.textContent = "🗺️ Unfold to map";
    } else {
      els.globeBtn.textContent = "Unfolding…";
      els.skyFrom.value = "space";
      await globe.unfold();
      globeActive = false;
      els.wrap.classList.remove("globe-on");
      globe.stop();
      drawDynamic(true);
      els.globeBtn.textContent = "🌐 Fold into globe";
    }
  } catch (err) {
    console.error(err);
    els.globeBtn.textContent = "3D not available";
  } finally {
    document.querySelectorAll(".globe-only").forEach((el) => (el.hidden = !globeActive));
    els.globeBtn.disabled = false;
    globeBusy = false;
  }
}

// ---------- Controls ----------
document.querySelectorAll(".seg button").forEach((b) => {
  b.addEventListener("click", () => {
    const speed = Number(b.dataset.speed);
    if (speed === 1) setClock({ sim: Date.now(), speed: 1, live: true });
    else setClock({ speed, live: false });
  });
});

function toLocalInput(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
els.jump.value = toLocalInput(new Date());
els.jump.addEventListener("change", () => {
  const t = new Date(els.jump.value);
  if (!isNaN(t)) setClock({ sim: t.getTime(), speed: 1, live: false });
});

[els.showCities, els.showNoon, els.showGrid, els.showShip, els.showFlights, els.showRail].forEach((c) =>
  c.addEventListener("change", applyToggles)
);
els.spin.addEventListener("change", () => globe && globe.setAutoRotate(els.spin.checked));
function applySky() {
  if (globe) globe.setSky({ constellations: els.showCons.checked, planets: els.showPlanets.checked });
}
els.showCons.addEventListener("change", applySky);
els.showPlanets.addEventListener("change", applySky);
els.globeBtn.addEventListener("click", toggleGlobe);
els.zoomIn.addEventListener("click", () => zoomBy(1.6));
els.zoomOut.addEventListener("click", () => zoomBy(1 / 1.6));
els.zoomReset.addEventListener("click", zoomReset);

// Ask the browser for the user's position (once); resolves to `me` or null.
function locateMe() {
  if (me) return Promise.resolve(me);
  if (!navigator.geolocation) {
    els.locate.textContent = "Location unavailable";
    return Promise.resolve(null);
  }
  els.locate.textContent = "Locating…";
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        me = { lon: pos.coords.longitude, lat: pos.coords.latitude };
        me.p = projection([me.lon, me.lat]);
        layers.me.textContent = "";
        el("circle", { r: 4.5 }, layers.me);
        el("text", { dx: 7, dy: 4 }, layers.me).textContent = "You";
        els.locate.textContent = "📍 Located";
        lastSecond = -1;
        drawDynamic(true);
        resolve(me);
      },
      () => {
        els.locate.textContent = "📍 Location denied";
        resolve(null);
      },
      { maximumAge: 600000, timeout: 15000 }
    );
  });
}
els.locate.addEventListener("click", locateMe);

// "Sky from": look up at the sky as it appears from a place on Earth.
CITIES.forEach(([name], i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = name;
  els.skyFrom.appendChild(o);
});
els.skyFrom.addEventListener("change", async () => {
  if (!globe) return;
  const v = els.skyFrom.value;
  if (v === "space") return globe.setFocus(null);
  if (v === "me") {
    const pos = await locateMe();
    if (!pos) {
      els.skyFrom.value = "space";
      return globe.setFocus(null);
    }
    return globe.setFocus({ name: "you", lon: pos.lon, lat: pos.lat, tz: userTz });
  }
  const [name, lon, lat, tz] = CITIES[Number(v)];
  globe.setFocus({ name, lon, lat, tz });
});

// ---------- Main loop ----------
function tick() {
  drawDynamic();
  if (!clock.live) {
    const t = simNow();
    if (document.activeElement !== els.jump && clock.speed > 1) els.jump.value = toLocalInput(t);
  }
  requestAnimationFrame(tick);
}

const getJSON = (f) => fetch(`data/${f}`).then((r) => r.json());

async function loadData() {
  const status = (s) => (els.loading.textContent = s);
  try {
    status("Loading land…");
    const land = await getJSON("land-50m.json");
    data.land = topojson.feature(land, land.objects.land);
    await drawData("land");

    status("Loading routes…");
    const [ship, flights, rail] = await Promise.all(["shipping.json", "flights.json", "rail.json"].map(getJSON));
    data.ship = [1, 2, 3].map((k) => ({ type: "MultiLineString", coordinates: ship.lanes[k] || [] }));
    data.ports = ship.ports;
    await drawData("ship");

    const ap = flights.airports;
    const arc = ([a, b]) => [ap[a].slice(1, 3), ap[b].slice(1, 3)];
    data.flights = { type: "MultiLineString", coordinates: flights.routes.filter((r) => r[2] < 6).map(arc) };
    data.flightsBusy = { type: "MultiLineString", coordinates: flights.routes.filter((r) => r[2] >= 6).map(arc) };
    await drawData("flights");

    data.rail = topojson.feature(rail, rail.objects[Object.keys(rail.objects)[0]]);
    await drawData("rail");
    status("");
    if (globe) globe.redrawTexture();
  } catch (err) {
    console.error("Could not load map data", err);
    status("Some map data failed to load.");
  }
}

function init() {
  buildLayers();
  drawStatic();
  drawDynamic(true);
  d3.select(els.svg).call(zoom).on("dblclick.zoom", null);
  new ResizeObserver(() => {
    const w = els.wrap.clientWidth;
    if (w) markerScale = VW / w;
    placeMarkers();
    if (globe && globeActive) globe.resize();
  }).observe(els.wrap);
  requestAnimationFrame(tick);
  loadData();
}

init();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
