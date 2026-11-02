// 3D view: the Dymaxion net folds into an icosahedron, inflates into a globe
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
    gl_FragColor = vec4(col, 1.0);
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

export function createGlobe({ canvas, d3, getTime, drawTexture }) {
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
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
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

  scene.add(makeStars());
  const sun = makeSun();
  sun.position.copy(sunScene).multiplyScalar(60);
  scene.add(sun);

  // ---- state ----
  const state = { fold: 0, morph: 0, yaw: 0, pitch: 0, zoom: 1, autoRotate: true, dragging: false };
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
    if (state.autoRotate && !state.dragging && state.morph === 1 && !anim) state.yaw += dt * 0.06;

    const date = getTime();
    const sub = subsolarPoint(date);
    uniforms.uSun.value.set(...lonLatToVec(sub.lon, sub.lat));
    uniforms.uFold.value = net.foldMatrices(ease(state.fold)).map(toMatrix4);
    uniforms.uMorph.value = ease(state.morph);
    atmosphere.material.uniforms.uOpacity.value = ease(state.morph);
    earth.matrix.copy(earthMatrix(date));
    earth.matrixWorldNeedsUpdate = true;

    // Camera: frame the flat net, then the globe.
    const t = Math.tan((FOV * Math.PI) / 360);
    const netDist = 1.08 * Math.max(net.bounds.height / 2 / t, net.bounds.width / 2 / (t * camera.aspect)) + 0.8;
    const globeDist = 1.7 / Math.min(t, t * camera.aspect) / state.zoom;
    const dist = mix(netDist, globeDist, ease(Math.min(1, state.fold * 0.6 + state.morph * 0.4)));
    const cp = Math.cos(state.pitch);
    camera.position.set(dist * Math.sin(state.yaw) * cp, dist * Math.sin(state.pitch), dist * Math.cos(state.yaw) * cp);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
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
    if (pointers.size === 1) {
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
    async unfold() {
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

function makeStars() {
  const n = 2500;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 200, z * 200, r * Math.sin(a) * 200], i * 3);
    const b = 0.35 + 0.65 * Math.pow(rand(), 3);
    const warm = rand();
    col.set([b, b * (0.9 + 0.1 * warm), b * (0.85 + 0.15 * (1 - warm))], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
}

function makeSun() {
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
  sprite.scale.set(14, 14, 1);
  return sprite;
}
