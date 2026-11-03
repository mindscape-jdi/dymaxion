// The sky around the globe: real stars, constellation figures, the five
// naked-eye planets and the Moon, all placed where they really are relative to
// the sun and Earth's axis at the displayed time.
//
// Stars, constellations, planets and the sun are drawn on a large sphere
// centred on the camera (they are effectively infinitely far away), so their
// directions are exact from any viewpoint. The Moon is a real object about 60
// Earth radii from the globe, enlarged so it can be seen, with its phase lit
// by the sun.

import * as THREE from "./vendor/three.module.min.js";
import { PLANETS, planetPosition, moonPosition, eclipticToScene, starsToScene, sphereVec, applyMat } from "./sky.js";

const R = 300; // radius of the sky sphere
const MOON_SCALE = 4; // the Moon is drawn 4× its real size

const toMatrix4 = (m) => new THREE.Matrix4().set(...m[0], 0, ...m[1], 0, ...m[2], 0, 0, 0, 0, 1);

// Approximate star colour from its B−V colour index.
function bvColor(bv) {
  const t = Math.max(-0.4, Math.min(2, bv));
  const stops = [[-0.4, [0.62, 0.72, 1]], [0, [0.85, 0.9, 1]], [0.6, [1, 0.97, 0.9]], [1.2, [1, 0.82, 0.6]], [2, [1, 0.62, 0.42]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const k = (t - a) / (b - a);
      return ca.map((v, j) => v + (cb[j] - v) * k);
    }
  }
  return stops[stops.length - 1][1];
}

const pointVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_PointSize = size * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.15, d);
    gl_FragColor = vec4(vColor, core);
  }
`;

function pointsMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const moonVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const moonFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vPos;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
  void main() {
    // A few soft dark patches suggest the maria.
    vec3 p = normalize(vPos);
    float maria = smoothstep(0.55, 0.85, 0.5 + 0.5 * sin(p.x * 5.0 + 1.3) * sin(p.y * 4.0 - 0.7) * sin(p.z * 3.0 + 2.1));
    vec3 base = mix(vec3(0.78, 0.77, 0.74), vec3(0.48, 0.48, 0.47), maria) * (0.95 + 0.05 * hash(floor(p * 40.0)));
    float lit = smoothstep(-0.04, 0.12, dot(vNormal, uSun));
    gl_FragColor = vec4(base * (0.035 + 0.965 * lit), 1.0);
  }
`;

export function createSky({ scene, sunDir, labelLayer, pixelRatio }) {
  const sky = new THREE.Group(); // follows the camera
  const celestial = new THREE.Group(); // rotated from RA/Dec into the scene frame
  celestial.matrixAutoUpdate = false;
  sky.add(celestial);
  scene.add(sky);

  // Placeholder star field until the catalogue loads.
  let stars = null;
  let lines = null;
  const conLabels = [];

  // Sun.
  const sun = makeSunSprite();
  sun.position.copy(sunDir).multiplyScalar(R * 0.95);
  sky.add(sun);

  // Planets.
  const planetGeom = new THREE.BufferGeometry();
  planetGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PLANETS.length * 3), 3));
  planetGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(PLANETS.flatMap((p) => new THREE.Color(p.color).toArray())), 3));
  planetGeom.setAttribute("size", new THREE.BufferAttribute(new Float32Array(PLANETS.map((p) => Math.max(6, Math.min(12, 9 - 1.4 * p.mag)))), 1));
  const planets = new THREE.Points(planetGeom, pointsMaterial(pixelRatio));
  planets.frustumCulled = false;
  sky.add(planets);

  // Moon.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.2727 * MOON_SCALE, 48, 32),
    new THREE.ShaderMaterial({ uniforms: { uSun: { value: sunDir } }, vertexShader: moonVertex, fragmentShader: moonFragment })
  );
  scene.add(moon);

  // HTML labels.
  const label = (text, cls) => {
    const el = document.createElement("span");
    el.className = `sky-label ${cls}`;
    el.textContent = text;
    labelLayer.appendChild(el);
    return el;
  };
  const planetLabels = PLANETS.map((p) => label(p.name, "planet"));
  const moonLabel = label("Moon", "planet moon");

  const show = { constellations: true, planets: true };

  function load(data) {
    const n = data.stars.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    data.stars.forEach(([ra, dec, mag, bv], i) => {
      pos.set(sphereVec(ra, dec).map((v) => v * R), i * 3);
      const b = Math.min(1, 0.6 + 0.4 * Math.pow(10, -0.4 * (mag - 1)));
      col.set(bvColor(bv).map((v) => v * b), i * 3);
      size[i] = Math.max(2.2, 8 - 1.1 * mag);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    stars = new THREE.Points(g, pointsMaterial(pixelRatio));
    stars.frustumCulled = false;
    celestial.add(stars);

    const seg = [];
    data.constellations.forEach((c) => {
      c.lines.forEach((line) => {
        for (let i = 1; i < line.length; i++) {
          seg.push(...sphereVec(...line[i - 1]).map((v) => v * R * 0.99), ...sphereVec(...line[i]).map((v) => v * R * 0.99));
        }
      });
      const el = label(c.name, c.rank === 1 ? "con major" : "con");
      conLabels.push({ el, dir: new THREE.Vector3(...sphereVec(...c.label)) });
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
    lines = new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ color: 0x7ea6ff, transparent: true, opacity: 0.32, depthWrite: false })
    );
    lines.frustumCulled = false;
    celestial.add(lines);
  }

  // Is direction `d` from the camera blocked by the globe (unit sphere at origin)?
  const tmp = new THREE.Vector3();
  function hiddenByEarth(cam, d, maxDist = Infinity) {
    const b = cam.dot(d);
    const c = cam.lengthSq() - 1;
    const disc = b * b - c;
    if (disc <= 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < maxDist;
  }

  function place(el, worldPos, camera, w, h, hidden) {
    tmp.copy(worldPos).project(camera);
    if (hidden || tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmp.y) / 2 * h).toFixed(1)}px)`;
  }

  const planetDirs = PLANETS.map(() => new THREE.Vector3());
  const moonDir = new THREE.Vector3();
  let earthSolid = 0;

  // Ground: hides everything below the observer's horizon in "sky from here" mode.
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.97, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: { uZenith: { value: new THREE.Vector3(0, 1, 0) }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform float uOpacity;
        varying vec3 vDir;
        void main() {
          float h = dot(normalize(vDir), uZenith); // sine of altitude
          if (h > 0.004) discard;
          float glow = smoothstep(-0.03, 0.004, h);
          vec3 c = mix(vec3(0.02, 0.035, 0.03), vec3(0.16, 0.22, 0.32), glow);
          gl_FragColor = vec4(c, uOpacity);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
  );
  ground.renderOrder = 5;
  ground.frustumCulled = false;
  sky.add(ground);

  function update(date, camera, sunAzimuth, globeAmount, occludeAmount = globeAmount, groundZenith = null, groundAmount = 0) {
    earthSolid = occludeAmount;
    ground.visible = groundAmount > 0.001 && !!groundZenith;
    if (ground.visible) {
      ground.material.uniforms.uZenith.value.set(...groundZenith);
      ground.material.uniforms.uOpacity.value = 0.94 * groundAmount;
    }
    sky.position.copy(camera.position);
    celestial.matrix.copy(toMatrix4(starsToScene(date, sunAzimuth)));
    celestial.matrixWorldNeedsUpdate = true;

    const ecl = eclipticToScene(date, sunAzimuth);
    const attr = planetGeom.attributes.position;
    PLANETS.forEach((p, i) => {
      const pp = planetPosition(p.name, date);
      planetDirs[i].set(...applyMat(ecl, sphereVec(pp.lon, pp.lat)));
      attr.setXYZ(i, ...planetDirs[i].clone().multiplyScalar(R * 0.98).toArray());
    });
    attr.needsUpdate = true;

    const m = moonPosition(date);
    moonDir.set(...applyMat(ecl, sphereVec(m.lon, m.lat)));
    moon.position.copy(moonDir).multiplyScalar(m.dist);
    moon.visible = show.planets && globeAmount > 0.5;
    planets.visible = show.planets;
    if (lines) lines.visible = show.constellations;
  }

  function updateLabels(camera, w, h) {
    const cam = camera.position;
    const occlude = earthSolid > 0.9;
    const dir = new THREE.Vector3();
    // In "sky from here" mode, hide labels for things below the horizon.
    const zen = ground.visible ? ground.material.uniforms.uZenith.value : null;
    const below = (d) => zen !== null && d.dot(zen) < 0;
    PLANETS.forEach((p, i) => {
      const hidden = !show.planets || below(planetDirs[i]) || (occlude && hiddenByEarth(cam, planetDirs[i]));
      place(planetLabels[i], dir.copy(planetDirs[i]).multiplyScalar(R).add(cam), camera, w, h, hidden);
    });
    const toMoon = moon.position.clone().sub(cam);
    const md = toMoon.length();
    place(moonLabel, moon.position, camera, w, h, !moon.visible || below(moonDir) || (occlude && hiddenByEarth(cam, toMoon.normalize(), md)));
    conLabels.forEach(({ el, dir: d }) => {
      dir.copy(d).applyMatrix4(celestial.matrix);
      const hidden = !show.constellations || below(dir) || (occlude && hiddenByEarth(cam, dir));
      place(el, dir.clone().multiplyScalar(R).add(cam), camera, w, h, hidden);
    });
  }

  return {
    load,
    update,
    updateLabels,
    set(options) {
      Object.assign(show, options);
    },
    hideLabels() {
      labelLayer.querySelectorAll(".sky-label").forEach((el) => (el.style.display = "none"));
    },
  };
}

function makeSunSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,245,1)");
  g.addColorStop(0.12, "rgba(255,240,190,1)");
  g.addColorStop(0.3, "rgba(255,200,90,0.45)");
  g.addColorStop(1, "rgba(255,170,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false })
  );
  sprite.scale.set(70, 70, 1);
  return sprite;
}
