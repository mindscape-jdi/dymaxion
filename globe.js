// 3D view: the Fuller projection net folds into an icosahedron, inflates into a globe
// and floats in space, lit by the sun from its true direction.
//
// Lighting is computed per pixel from the sun's direction in Earth-fixed
// coordinates, so the flat net, the folding solid and the globe all show the
// same day/night pattern as the 2D map. The globe itself is oriented with
// earthToScene(): the sun sits at a fixed direction in the scene, "up" is the
// ecliptic north pole, so Earth's 23.44° tilt and daily spin are real.

import * as THREE from "./vendor/three.module.min.js";
import { buildNet } from "./fold.js";
import { subsolarPoint, earthToScene, lonLatToVec, HORIZON } from "./sun.js";
import { createSky } from "./skyview.js";
import { observerFrame } from "./sky.js";
import { phaseOf, sunAltitude } from "./sun.js";

const FOCUS_FOV = 80; // wide view of the sky in "sky from here" mode
const FOCUS_DIST = 7; // camera distance from Earth's centre in that mode

const SUN_AZIMUTH = -25; // sun 65° to the right of the starting camera, so the terminator shows
const FOLD_MS = 2600;
const MORPH_MS = 1800;
const FOV = 35;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;

const vertexShader = /* glsl */ `
  attribute vec2 aFlat;
  attribute vec3 dir;
  attribute float piece;
  uniform mat4 uFold[24];
  uniform mat4 uM;
  uniform float uMorph;
  varying vec3 vDir;
  void main() {
    int i = int(piece + 0.5);
    vec3 folded = (uFold[i] * vec4(aFlat, 0.0, 1.0)).xyz;
    vec3 sphere = (uM * vec4(dir, 1.0)).xyz;
    vDir = dir;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(folded, sphere, uMorph), 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSun;
  uniform float uMorph;
  uniform float uAlpha;
  varying vec3 vDir;
  const float PI = 3.141592653589793;
  float band(float alt, float edge) { return smoothstep(edge + 0.35, edge - 0.35, alt); }
  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.z, -1.0, 1.0)) / PI + 0.5);
    vec3 col = texture2D(uMap, uv).rgb;
    float s = dot(d, uSun);
    float alt = degrees(asin(clamp(s, -1.0, 1.0)));
    // Same stepped twilight bands as the 2D map.
    float n = band(alt, ${HORIZON.toFixed(3)}) + band(alt, -6.0) + band(alt, -12.0) + band(alt, -18.0);
    float shade = pow(0.71, n);
    // On the globe, add soft Lambert shading so the sphere reads as 3D.
    float lambert = mix(1.0, 0.55 + 0.45 * sqrt(max(s, 0.0)), uMorph);
    vec3 night = vec3(0.015, 0.03, 0.08);
    col = mix(night, col * lambert, shade);
    gl_FragColor = vec4(col, uAlpha);
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const atmosphereFragment = /* glsl */ `
  uniform vec3 uSunScene;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    float lit = smoothstep(-0.35, 0.4, dot(vNormal, uSunScene));
    vec3 c = mix(vec3(0.05, 0.08, 0.2), vec3(0.35, 0.65, 1.0), lit);
    gl_FragColor = vec4(c, rim * uOpacity * (0.25 + 0.75 * lit));
  }
`;

export function createGlobe({ canvas, d3, getTime, drawTexture, labelLayer }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x02040a);
  // Colours are written as-is (the texture is already sRGB), with no conversion.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 500);

  // Texture: an equirectangular rendering of the map layers.
  const texCanvas = document.createElement("canvas");
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, 4096);
  texCanvas.width = maxTex;
  texCanvas.height = maxTex / 2;
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.generateMipmaps = false; // avoids a seam where longitude wraps
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Net geometry.
  const net = buildNet(d3, d3.geoAirocean(), 16);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(net.dirs.length), 3));
  geometry.setAttribute("aFlat", new THREE.BufferAttribute(net.flatXY, 2));
  geometry.setAttribute("dir", new THREE.BufferAttribute(net.dirs, 3));
  geometry.setAttribute("piece", new THREE.BufferAttribute(net.pieceIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(net.indices, 1));

  const toMatrix4 = (m) => new THREE.Matrix4().set(...m);
  const uniforms = {
    uFold: { value: net.foldMatrices(0).map(toMatrix4) },
    uM: { value: toMatrix4(net.M) },
    uMorph: { value: 0 },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uMap: { value: texture },
    uAlpha: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10; // after the sky, so a see-through globe blends over it
  const earth = new THREE.Group();
  earth.matrixAutoUpdate = false;
  earth.add(mesh);
  scene.add(earth);

  const sunScene = new THREE.Vector3(Math.cos(SUN_AZIMUTH * Math.PI / 180), 0, -Math.sin(SUN_AZIMUTH * Math.PI / 180));

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: { uSunScene: { value: sunScene }, uOpacity: { value: 0 } },
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(atmosphere);

  const sky = createSky({ scene, sunDir: sunScene, labelLayer, pixelRatio: renderer.getPixelRatio() });

  // "Sky from here": a marker for the observer and compass/status labels.
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5b7f, depthTest: false, transparent: true })
  );
  marker.renderOrder = 11;
  marker.visible = false;
  scene.add(marker);
  const compass = ["N", "E", "S", "W"].map((t) => {
    const el = document.createElement("span");
    el.className = "sky-label compass";
    el.textContent = t;
    labelLayer.appendChild(el);
    return el;
  });
  const status = document.createElement("div");
  status.className = "sky-status";
  labelLayer.appendChild(status);

  // ---- state ----
  const state = {
    fold: 0, morph: 0, yaw: 0, pitch: 0, zoom: 1, autoRotate: true, dragging: false,
    focus: null, focusAmt: 0, focusTarget: 0, lookAz: 180, lookAlt: 55,
  };
  let anim = null;
  let running = false;
  let lastFrame = performance.now();

  // Rigid parts of M (Earth-fixed → net frame).
  const Mrot = new THREE.Matrix4().extractRotation(uniforms.uM.value);
  const Mt = new THREE.Vector3().setFromMatrixPosition(uniforms.uM.value);
  const qM = new THREE.Quaternion().setFromRotationMatrix(Mrot);

  // Group transform. While folding, slide the solid's centre to the origin;
  // then turn it about its centre until it matches the real Earth orientation.
  function earthMatrix(date) {
    const r = earthToScene(date, SUN_AZIMUTH);
    const qR = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().set(...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1)
    );
    const qFinal = qR.multiply(qM.clone().invert());
    const q = new THREE.Quaternion().slerp(qFinal, ease(state.morph));
    const center = Mt.clone().multiplyScalar(-ease(state.fold));
    return new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(new THREE.Matrix4().makeTranslation(center));
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (anim) anim(now);
    if (state.autoRotate && !state.dragging && state.morph === 1 && !anim && !state.focus) state.yaw += dt * 0.06;

    const date = getTime();
    const sub = subsolarPoint(date);
    uniforms.uSun.value.set(...lonLatToVec(sub.lon, sub.lat));
    uniforms.uFold.value = net.foldMatrices(ease(state.fold)).map(toMatrix4);
    uniforms.uMorph.value = ease(state.morph);
    earth.matrix.copy(earthMatrix(date));
    earth.matrixWorldNeedsUpdate = true;

    // Camera: frame the flat net, then the globe.
    const t = Math.tan((FOV * Math.PI) / 360);
    const netDist = 1.08 * Math.max(net.bounds.height / 2 / t, net.bounds.width / 2 / (t * camera.aspect)) + 0.8;
    const globeDist = 1.7 / Math.min(t, t * camera.aspect) / state.zoom;
    const dist = mix(netDist, globeDist, ease(Math.min(1, state.fold * 0.6 + state.morph * 0.4)));
    const cp = Math.cos(state.pitch);
    const orbitPos = new THREE.Vector3(dist * Math.sin(state.yaw) * cp, dist * Math.sin(state.pitch), dist * Math.cos(state.yaw) * cp);

    // "Sky from here": stand on the far side of Earth and look through it,
    // along the observer's line of sight, so the sky appears as they see it.
    if (state.focus && state.morph === 1) {
      state.focusAmt = Math.min(1, state.focusAmt + dt / 1.4);
    } else {
      state.focusAmt = Math.max(0, state.focusAmt - dt / 1.0);
    }
    const k = ease(state.focusAmt);
    let frameObs = null;
    if (state.focus && k > 0) {
      frameObs = observerFrame(date, state.focus.lon, state.focus.lat, SUN_AZIMUTH, earthToScene);
      const z = new THREE.Vector3(...frameObs.zenith);
      const n = new THREE.Vector3(...frameObs.north);
      const e = new THREE.Vector3(...frameObs.east);
      const alt = state.lookAlt * Math.PI / 180, az = state.lookAz * Math.PI / 180;
      const horiz = n.clone().multiplyScalar(Math.cos(az)).add(e.clone().multiplyScalar(Math.sin(az)));
      const view = z.clone().multiplyScalar(Math.sin(alt)).add(horiz.clone().multiplyScalar(Math.cos(alt)));
      const up = z.clone().multiplyScalar(Math.cos(alt)).sub(horiz.clone().multiplyScalar(Math.sin(alt)));
      const focusPos = view.clone().multiplyScalar(-FOCUS_DIST);
      const dir = orbitPos.clone().normalize().lerp(focusPos.clone().normalize(), k);
      if (dir.lengthSq() < 1e-6) dir.copy(up);
      camera.position.copy(dir.normalize().multiplyScalar(mix(orbitPos.length(), FOCUS_DIST, k)));
      camera.up.set(0, 1, 0).lerp(up, k).normalize();
      marker.position.copy(z);
    } else {
      camera.position.copy(orbitPos);
      camera.up.set(0, 1, 0);
    }
    const fov = mix(FOV, Math.max(25, Math.min(110, FOCUS_FOV / state.zoom)), k);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(0, 0, 0);

    // See-through globe while looking at the sky.
    uniforms.uAlpha.value = 1 - 0.78 * k;
    material.transparent = k > 0;
    material.depthWrite = k === 0;
    atmosphere.material.uniforms.uOpacity.value = ease(state.morph) * (1 - k);
    marker.visible = k > 0;
    marker.material.opacity = k;

    // Daytime at the chosen place tints the sky blue.
    let day = 0;
    if (frameObs) {
      const alt = sunAltitude(sub, state.focus.lon, state.focus.lat);
      day = k * Math.max(0, Math.min(1, (alt + 6) / 10));
    }
    renderer.setClearColor(clearNight.clone().lerp(clearDay, day));

    sky.update(date, camera, SUN_AZIMUTH, ease(state.morph), ease(state.morph) * (1 - k), frameObs && frameObs.zenith, k);
    renderer.render(scene, camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    sky.updateLabels(camera, w, h);
    updateFocusLabels(date, frameObs, k, w, h);
    requestAnimationFrame(frame);
  }

  const timeFmt = new Map();
  function localTime(date, tz) {
    const key = tz || "";
    if (!timeFmt.has(key)) {
      timeFmt.set(key, new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }));
    }
    return timeFmt.get(key).format(date);
  }

  const v3 = new THREE.Vector3();
  const clearNight = new THREE.Color(0x02040a);
  const clearDay = new THREE.Color(0x1f4a78);
  function updateFocusLabels(date, f, k, w, h) {
    const on = f && k > 0.6;
    status.style.display = on ? "" : "none";
    compass.forEach((el, i) => {
      if (!on) {
        el.style.display = "none";
        return;
      }
      // Cardinal points, a little above the horizon.
      const az = (i * 90 * Math.PI) / 180, alt = (8 * Math.PI) / 180;
      const d = [0, 1, 2].map((j) => f.zenith[j] * Math.sin(alt) + Math.cos(alt) * (f.north[j] * Math.cos(az) + f.east[j] * Math.sin(az)));
      v3.set(...d).multiplyScalar(250).add(camera.position).project(camera);
      const visible = v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1;
      el.style.display = visible ? "" : "none";
      el.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px)`;
    });
    if (on) {
      const { name, lon, lat, tz } = state.focus;
      const alt = sunAltitude(subsolarPoint(date), lon, lat);
      const phase = phaseOf(alt);
      const note = alt > -6 ? " · stars would be washed out by daylight" : "";
      const dirName = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((state.lookAz % 360) + 360) % 360) / 45) % 8];
      status.innerHTML = `<b>Sky above ${name}</b> · ${localTime(date, tz)} · ${phase}${note}<br>` +
        `<span>Facing ${dirName}, looking ${Math.round(state.lookAlt)}° up · drag to look around · the globe is see-through</span>`;
    }
  }

  function animate(from, to, ms, apply) {
    return new Promise((resolve) => {
      const start = performance.now();
      anim = (now) => {
        const t = Math.min(1, (now - start) / ms);
        apply(mix(from, to, t), t);
        if (t === 1) {
          anim = null;
          resolve();
        }
      };
    });
  }

  // ---- interaction (globe only) ----
  const pointers = new Map();
  let pinchStart = 0, zoomStart = 1;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    state.dragging = true;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomStart = state.zoom;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || state.morph < 1 || anim) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1 && state.focus) {
      // Look around: drag sideways to turn, up/down to raise or lower your gaze.
      const s = 0.25 / state.zoom;
      state.lookAz = (state.lookAz + (e.clientX - prev[0]) * s + 360) % 360;
      state.lookAlt = Math.max(5, Math.min(90, state.lookAlt + (e.clientY - prev[1]) * s));
    } else if (pointers.size === 1) {
      state.yaw -= (e.clientX - prev[0]) * 0.006 / state.zoom;
      state.pitch = Math.max(-1.3, Math.min(1.3, state.pitch + (e.clientY - prev[1]) * 0.006 / state.zoom));
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      setZoom(zoomStart * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinchStart);
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) state.dragging = false;
    pinchStart = 0;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("wheel", (e) => {
    if (state.morph < 1) return;
    e.preventDefault();
    setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  const setZoom = (z) => (state.zoom = Math.max(0.6, Math.min(6, z)));

  return {
    start() {
      if (running) return;
      running = true;
      resize();
      lastFrame = performance.now();
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      sky.hideLabels();
      compass.forEach((el) => (el.style.display = "none"));
      status.style.display = "none";
    },
    loadSky(data) {
      sky.load(data);
    },
    setSky(options) {
      sky.set(options);
    },
    resize,
    redrawTexture() {
      drawTexture(texCanvas);
      texture.needsUpdate = true;
    },
    async fold() {
      await animate(state.fold, 1, FOLD_MS * (1 - state.fold), (v) => (state.fold = v));
      await animate(state.morph, 1, MORPH_MS * (1 - state.morph), (v) => (state.morph = v));
    },
    // Show the sky as seen from {name, lon, lat, tz}; null returns to the free view.
    setFocus(place) {
      if (place) {
        if (!state.focus || state.focus.name !== place.name) {
          // Face the equator: south from the north, north from the south.
          state.lookAz = place.lat >= 0 ? 180 : 0;
          state.lookAlt = 55;
          state.zoom = 1;
        }
        state.focus = place;
      } else {
        state.focus = null;
        state.zoom = 1;
      }
    },
    async unfold() {
      if (state.focus) {
        state.focus = null;
        await new Promise((r) => {
          const wait = () => (state.focusAmt === 0 ? r() : requestAnimationFrame(wait));
          wait();
        });
      }
      const yaw = ((state.yaw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      const pitch = state.pitch, zoom = state.zoom;
      await animate(state.morph, 0, MORPH_MS * state.morph, (v, t) => {
        state.morph = v;
        state.yaw = mix(yaw, 0, ease(t));
        state.pitch = mix(pitch, 0, ease(t));
        state.zoom = mix(zoom, 1, ease(t));
      });
      await animate(state.fold, 0, FOLD_MS * state.fold, (v) => (state.fold = v));
    },
    zoomBy(k) {
      setZoom(state.zoom * k);
    },
    setView(yaw, pitch) {
      state.yaw = yaw;
      state.pitch = pitch;
    },
    resetView() {
      state.zoom = 1;
      state.pitch = 0;
    },
    setAutoRotate(on) {
      state.autoRotate = on;
    },
    get folded() {
      return state.morph === 1;
    },
  };
}
