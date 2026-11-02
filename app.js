import { subsolarPoint, sunAltitude, phaseOf, HORIZON } from "./sun.js";

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

const els = {
  svg: document.getElementById("map"),
  wrap: document.getElementById("mapWrap"),
  tooltip: document.getElementById("tooltip"),
  localTime: document.getElementById("localTime"),
  localDate: document.getElementById("localDate"),
  tzName: document.getElementById("tzName"),
  utcTime: document.getElementById("utcTime"),
  badge: document.getElementById("modeBadge"),
  facts: document.getElementById("facts"),
  cityList: document.getElementById("cityList"),
  jump: document.getElementById("jump"),
  showCities: document.getElementById("showCities"),
  showNoon: document.getElementById("showNoon"),
  showGrid: document.getElementById("showGrid"),
  locate: document.getElementById("locate"),
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
const projection = d3.geoAirocean();
const path = d3.geoPath(projection);
let size = { w: 0, h: 0 };
let land = null;
let me = null; // user's location, if shared

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
  const defs = el("defs", {}, svg);
  const clip = el("clipPath", { id: "sphereClip" }, defs);
  layers.clipPath = el("path", {}, clip);
  const grad = el("radialGradient", { id: "sunGlow" }, defs);
  el("stop", { offset: "0%", "stop-color": "#fffbe6" }, grad);
  el("stop", { offset: "35%", "stop-color": "#ffd34d" }, grad);
  el("stop", { offset: "70%", "stop-color": "#ffb300", "stop-opacity": "0.35" }, grad);
  el("stop", { offset: "100%", "stop-color": "#ffb300", "stop-opacity": "0" }, grad);

  layers.ocean = el("path", { class: "ocean" }, svg);
  const clipped = el("g", { "clip-path": "url(#sphereClip)" }, svg);
  layers.grid = el("path", { class: "graticule" }, clipped);
  layers.equator = el("path", { class: "equator" }, clipped);
  layers.land = el("path", { class: "land" }, clipped);
  layers.shade = BANDS.map(() => el("path", { class: "shade", "fill-opacity": BAND_OPACITY }, clipped));
  layers.terminator = el("path", { class: "terminator" }, clipped);
  layers.noon = el("g", {}, clipped);
  layers.noonLine = el("path", { class: "noon-line" }, layers.noon);
  layers.noonMarks = el("g", {}, layers.noon);
  layers.cities = el("g", {}, svg);
  layers.me = el("g", { class: "me" }, svg);
  layers.sun = el("g", { class: "sun" }, svg);
  el("circle", { r: 16, fill: "url(#sunGlow)" }, layers.sun);
  el("circle", { r: 4.5, fill: "#fff6c8", stroke: "#ff9d00", "stroke-width": 1.2 }, layers.sun);
  layers.outline = el("path", { class: "outline" }, svg);

  layers.cityNodes = CITIES.map(([name]) => {
    const g = el("g", { class: "city" }, layers.cities);
    el("circle", { r: 3 }, g);
    const t = el("text", { dx: 5, dy: 3 }, g);
    t.textContent = name;
    return g;
  });
}

function resize() {
  const r = els.wrap.getBoundingClientRect();
  if (!r.width) return;
  size = { w: r.width, h: r.height };
  els.svg.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
  const pad = Math.max(6, Math.min(size.w, size.h) * 0.02);
  projection.fitExtent([[pad, pad], [size.w - pad, size.h - pad]], { type: "Sphere" });
  drawStatic();
  drawDynamic(true);
}

function drawStatic() {
  const sphere = path({ type: "Sphere" });
  layers.ocean.setAttribute("d", sphere);
  layers.outline.setAttribute("d", sphere);
  layers.clipPath.setAttribute("d", sphere);
  layers.grid.setAttribute("d", path(d3.geoGraticule10()));
  layers.equator.setAttribute("d", path({ type: "LineString", coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] }));
  if (land) layers.land.setAttribute("d", path(land));
  layers.grid.style.display = els.showGrid.checked ? "" : "none";
  layers.equator.style.display = els.showGrid.checked ? "" : "none";
}

function translate(node, p) {
  if (!p || !isFinite(p[0])) {
    node.style.display = "none";
    return;
  }
  node.style.display = "";
  node.setAttribute("transform", `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`);
}

// Region where the sun is below altitude `alt`: a spherical cap around the
// anti-solar point with radius 90° + alt.
function shadeCap(sub, alt) {
  const anti = [sub.lon + 180, -sub.lat];
  return d3.geoCircle().center(anti).radius(90 + alt).precision(0.5)();
}

let lastShadeKey = "";
function drawDynamic(force = false) {
  if (!size.w) return;
  const now = simNow();
  const sub = subsolarPoint(now);

  // Only redraw the shading when the sun has moved enough to matter (~0.02°).
  const key = `${sub.lon.toFixed(2)},${sub.lat.toFixed(2)}`;
  if (force || key !== lastShadeKey) {
    lastShadeKey = key;
    BANDS.forEach((alt, i) => layers.shade[i].setAttribute("d", path(shadeCap(sub, alt))));
    const term = shadeCap(sub, HORIZON);
    layers.terminator.setAttribute("d", path({ type: "LineString", coordinates: term.coordinates[0] }));
    translate(layers.sun, projection([sub.lon, sub.lat]));
    drawNoonLine(now);
  }

  // Cities.
  const showCities = els.showCities.checked;
  layers.cities.style.display = showCities ? "" : "none";
  CITIES.forEach(([, lon, lat], i) => {
    const node = layers.cityNodes[i];
    translate(node, projection([lon, lat]));
    node.setAttribute("class", `city ${bucket(sunAltitude(sub, lon, lat))}`);
  });

  if (me) {
    translate(layers.me, projection([me.lon, me.lat]));
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
  layers.noon.style.display = els.showNoon.checked ? "" : "none";
  if (!els.showNoon.checked) return;
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
  for (let h = -11; h <= 12; h++) {
    const t = new Date(start.getTime() + h * 3600000);
    if (Math.abs(t - now) < 20 * 60000) continue; // the sun marker is here already
    const s = subsolarPoint(t);
    const p = projection([s.lon, s.lat]);
    if (!p || !isFinite(p[0])) continue;
    const g = el("g", { transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` }, layers.noonMarks);
    el("circle", { r: 1.8, class: "noon-dot" }, g);
    const label = el("text", { class: "noon-label", y: -5, "text-anchor": "middle" }, g);
    label.textContent = String(t.getUTCHours()).padStart(2, "0");
  }
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

  if (hover) showTooltip(hover);
}

// ---------- Hover / tap inspector ----------
let hover = null;
function pointerToLonLat(evt) {
  const r = els.svg.getBoundingClientRect();
  const x = evt.clientX - r.left;
  const y = evt.clientY - r.top;
  const ll = projection.invert([x, y]);
  if (!ll || !isFinite(ll[0])) return null;
  // Reject points outside the unfolded net: re-projecting must land back on the cursor.
  const back = projection(ll);
  if (!back || Math.hypot(back[0] - x, back[1] - y) > 1.5) return null;
  return { x, y, lon: ll[0], lat: ll[1] };
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
  tt.style.left = `${Math.min(Math.max(h.x, 95), size.w - 95)}px`;
  tt.style.top = `${Math.max(h.y, 80)}px`;
}

els.svg.addEventListener("pointermove", (e) => {
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
els.svg.addEventListener("pointerdown", (e) => {
  hover = pointerToLonLat(e);
  if (hover) showTooltip(hover);
  else els.tooltip.hidden = true;
});

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

[els.showCities, els.showNoon].forEach((c) => c.addEventListener("change", () => drawDynamic(true)));
els.showGrid.addEventListener("change", drawStatic);

els.locate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    els.locate.textContent = "Location unavailable";
    return;
  }
  els.locate.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      me = { lon: pos.coords.longitude, lat: pos.coords.latitude };
      layers.me.textContent = "";
      el("circle", { r: 4.5 }, layers.me);
      el("text", { dx: 7, dy: 4 }, layers.me).textContent = "You";
      els.locate.textContent = "📍 Located";
      lastSecond = -1;
      drawDynamic(true);
    },
    () => (els.locate.textContent = "📍 Location denied"),
    { maximumAge: 600000, timeout: 15000 }
  );
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

async function init() {
  buildLayers();
  new ResizeObserver(resize).observe(els.wrap);
  resize();
  // On narrow screens the map scrolls sideways; start centred.
  const sc = document.getElementById("mapScroll");
  sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
  try {
    const topo = await fetch("data/land-50m.json").then((r) => r.json());
    land = topojson.feature(topo, topo.objects.land);
    drawStatic();
  } catch (err) {
    console.error("Could not load land data", err);
  }
  requestAnimationFrame(tick);
}

init();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
