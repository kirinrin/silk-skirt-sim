import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import {
  Leg, NU, NV, SUV, S_ROW, REST, rowOfS, smooth, FOOT_PITCH,
  buildTorso, buildColliders,
  gridNormals,
} from './body.js';
import { StockingLeg, createStockingMaterial, denierToDensity, STYLES } from './stockings.js';
import { Skirt } from './skirt.js';
import { makePlaid, PLAIDS } from './textures.js';
import { BODY } from './bodydata.js';
const ANKLE_P = BODY.ankle;

// ------------------------------------------------------------------ 参数
const STOCKING_COLORS = {
  '黑丝': '#0d0d11', '肉丝': '#c2957a', '白丝': '#f3f0ee', '灰丝': '#5d5d66',
  '咖啡': '#44291c', '酒红': '#5a0f20', '藏青': '#121a3a',
};
const P = {
  stockOn: true, style: '连裤袜', preset: '黑丝', color: STOCKING_COLORS['黑丝'],
  denier: 20, gloss: 0.35, tension: 0.7,
  plaid: '棕色格纹', length: 0.42, pleats: 28,
  wind: 0, windDir: 90, updraft: 0, weight: 0.6, air: 0.25,
  skin: '#eec0a8', shoes: true, idle: true, paused: false,
};

// ------------------------------------------------------------------ 渲染器 / 场景
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15161b);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
camera.position.set(0.55, 0.78, 2.75);

const key = new THREE.DirectionalLight(0xfff1e2, 2.7);
key.position.set(1.3, 2.7, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.9, right: 0.9, top: 1.0, bottom: -0.9, near: 0.5, far: 7 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.006; key.shadow.radius = 5;
key.target.position.set(0, 0.6, 0);
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xbfd0ff, 1.7); rim.position.set(-1.6, 1.7, -2.2); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffe0d0, 0.5); fill.position.set(-2.2, 0.9, 1.6); scene.add(fill);
scene.add(new THREE.HemisphereLight(0x8890a8, 0x1a1512, 0.35));

const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ------------------------------------------------------------------ 身体
const root = { x: 0, y: 0.97, z: 0, yaw: 0 };
const legs = [new Leg(1), new Leg(-1)];
const colliders = buildColliders(legs);

const skinMat = new THREE.MeshPhysicalMaterial({
  color: P.skin, roughness: 0.52, vertexColors: true,
  sheen: 0.5, sheenColor: 0xff7755, sheenRoughness: 0.55, specularIntensity: 0.45,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
// 顶点色：膝盖/脚跟微红，顶部是打底短裤
const legColors = new Float32Array(NU * NV * 3);
for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
  const s = S_ROW[j], sn = SUV[(j * NU + i) * 3 + 1], k = (j * NU + i) * 3;
  const knee = Math.exp(-(((s - 0.425) / 0.035) ** 2)) * Math.max(0, sn) * 0.16;
  const heel = smooth(0.84, 0.9, s) * 0.10;
  const shorts = 0;
  const red = knee + heel;
  legColors[k] = (1 - red * 0.15) * (1 - shorts * 0.96);
  legColors[k + 1] = (1 - red) * (1 - shorts * 0.96);
  legColors[k + 2] = (1 - red * 0.9) * (1 - shorts * 0.95);
}
const skinMeshes = legs.map((leg) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(leg.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(leg.nrm, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(legColors, 3));
  g.setIndex(new THREE.BufferAttribute(leg.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 5);
  const m = new THREE.Mesh(g, skinMat);
  m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
});

const bodyGroup = new THREE.Group(); scene.add(bodyGroup);
const torso = buildTorso();
const shortsMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.8 });
const topMat = new THREE.MeshPhysicalMaterial({ color: 0xe8ddcc, roughness: 0.9, sheen: 0.6, sheenColor: 0xffffff, sheenRoughness: 0.8 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0x5b4336, roughness: 0.8 });
for (const [g, m] of [[torso.pelvis, shortsMat], [torso.top, topMat], [torso.band, bandMat]]) {
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; bodyGroup.add(mesh);
}

// ------------------------------------------------------------------ 丝袜
const stockMat = createStockingMaterial();
const stockings = legs.map((leg) => { const s = new StockingLeg(leg, stockMat); scene.add(s.mesh); return s; });

function applyStocking() {
  const u = stockMat.userData.uniforms, st = STYLES[P.style];
  const col = new THREE.Color(P.color);
  stockMat.color.copy(col);
  stockMat.sheenColor.copy(col).lerp(new THREE.Color(0xffffff), 0.18).multiplyScalar(0.25 + P.gloss * 0.5);
  stockMat.roughness = 0.78 - P.gloss * 0.5;
  stockMat.sheenRoughness = 0.5 - P.gloss * 0.2;
  u.uDensity.value = denierToDensity(P.denier);
  u.uGloss.value = P.gloss;
  u.uTop.value = st.top; u.uBand.value = st.band;
  for (const s of stockings) { s.mesh.visible = P.stockOn; s.tension = P.tension; }
}

// ------------------------------------------------------------------ 鞋
const SHOE_J0 = rowOfS(0.80), SHOE_ROWS = NV - SHOE_J0;
const shoeMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
shoeMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aSUV; varying vec3 vSUV;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUV = aSUV;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSUV;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float q = vSUV.z - 0.82;
        float sn = normalize(vSUV.xy).y;
        float line = mix(-0.34, 0.22, 1. - smoothstep(0.03, 0.085, q));
        line = mix(line, 1.6, smoothstep(0.150, 0.192, q));
        line -= (1. - smoothstep(0.004, 0.016, q)) * 3.;
        if (sn > line) discard;
      }`);
};
const TOE_J0 = rowOfS(0.93) - SHOE_J0, shoeTmp = new Float32Array(NU * SHOE_ROWS * 3);
const heelGeo = new THREE.CylinderGeometry(0.0105, 0.0042, 1, 16);
const shoes = legs.map((leg) => {
  const n = NU * SHOE_ROWS;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSUV', new THREE.BufferAttribute(SUV.subarray(SHOE_J0 * NU * 3), 3));
  const idx = [];
  for (let j = 0; j < SHOE_ROWS - 1; j++) for (let i = 0; i < NU; i++) {
    const a = j * NU + i, b = j * NU + (i + 1) % NU, c = a + NU, d = b + NU;
    if (leg.side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 5);
  const mesh = new THREE.Mesh(g, shoeMat); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const heel = new THREE.Mesh(heelGeo, shoeMat.clone()); heel.material.onBeforeCompile = () => {}; heel.castShadow = true;
  scene.add(mesh, heel);
  return { leg, mesh, heel, pos, nrm };
});
// 打底短裤的裤腿（包住大腿根部）
const SHORTS_ROWS = rowOfS(0.135) + 1;
const shortLegs = legs.map((leg) => {
  const n = NU * SHORTS_ROWS;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let j = 0; j < SHORTS_ROWS - 1; j++) for (let i = 0; i < NU; i++) {
    const a = j * NU + i, b = j * NU + (i + 1) % NU, c = a + NU, d = b + NU;
    if (leg.side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 5);
  const mesh = new THREE.Mesh(g, shortsMat); mesh.frustumCulled = false; mesh.receiveShadow = true;
  scene.add(mesh);
  return { leg, mesh, pos, nrm };
});
function updateShorts() {
  for (const sh of shortLegs) {
    const lp = sh.leg.pos, ln = sh.leg.nrm;
    for (let k = 0; k < sh.pos.length; k++) { sh.pos[k] = lp[k] + ln[k] * 0.0022; sh.nrm[k] = ln[k]; }
    sh.mesh.geometry.attributes.position.needsUpdate = true;
    sh.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}
// 鞋跟：上端固定在脚跟底部，下端在站姿时刚好触地
const HEEL_V = rowOfS(0.842) * NU + (NU * 3) / 4;
const heelA = [REST[HEEL_V * 3], REST[HEEL_V * 3 + 1], REST[HEEL_V * 3 + 2]];
const heelB = (() => {
  const leg = legs[0], t = [0, 0, 0];
  leg.foot = FOOT_PITCH; leg.updateLocal();
  leg.skin(heelA[0], heelA[1], heelA[2], 0.86, t);
  // 站姿下的鞋跟底端，再反算回静止姿态
  const by = leg.minY - 0.004 - 0, bz = t[2] - 0.006;
  const c = Math.cos(-FOOT_PITCH), sn = Math.sin(-FOOT_PITCH), A = ANKLE_P;
  const py = by - A[1], pz = bz - A[2];
  leg.foot = 0;
  return [heelA[0], py * c - pz * sn + A[1], py * sn + pz * c + A[2]];
})();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _t = [0, 0, 0];
function localToWorld(t, out) {
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
  return out.set(t[0] * c + t[2] * s + root.x, t[1] + root.y, -t[0] * s + t[2] * c + root.z);
}
function updateShoes() {
  for (const sh of shoes) {
    sh.mesh.visible = sh.heel.visible = P.shoes;
    if (!P.shoes) continue;
    const lp = sh.leg.pos, ln = sh.leg.nrm, off = SHOE_J0 * NU * 3;
    for (let j = 0; j < SHOE_ROWS; j++) {
      const o = 0.0034 + 0.007 * smooth(0.92, 0.99, S_ROW[SHOE_J0 + j]);
      for (let k = j * NU * 3; k < (j + 1) * NU * 3; k++) { sh.pos[k] = lp[off + k] + ln[off + k] * o; sh.nrm[k] = ln[off + k]; }
    }
    // 鞋头：把脚趾的起伏抹平成光滑的鞋面
    const p = sh.pos, tmp = shoeTmp;
    for (let pass = 0; pass < 16; pass++) {
      tmp.set(p);
      for (let j = TOE_J0; j < SHOE_ROWS - 1; j++) {
        const w = 0.9 * smooth(0.93, 0.975, S_ROW[SHOE_J0 + j]);
        for (let i = 0; i < NU; i++) for (let c = 0; c < 3; c++) {
          const a = (j * NU + i) * 3 + c;
          const m = (tmp[(j * NU + (i + 1) % NU) * 3 + c] + tmp[(j * NU + (i + NU - 1) % NU) * 3 + c] + tmp[a - NU * 3] + tmp[a + NU * 3]) / 4;
          p[a] = tmp[a] + (m - tmp[a]) * w;
        }
      }
    }
    gridNormals(p, sh.nrm, NU, SHOE_ROWS);
    if (sh.leg.side < 0) for (let k = 0; k < sh.nrm.length; k++) sh.nrm[k] = -sh.nrm[k];
    sh.mesh.geometry.attributes.position.needsUpdate = true;
    sh.mesh.geometry.attributes.normal.needsUpdate = true;
    localToWorld(sh.leg.skin(heelA[0], heelA[1], heelA[2], 0.86, _t), _a);
    localToWorld(sh.leg.skin(heelB[0], heelB[1], heelB[2], 0.86, _t), _b);
    sh.heel.position.copy(_a).add(_b).multiplyScalar(0.5);
    sh.heel.scale.set(1, _a.distanceTo(_b), 1);
    sh.heel.quaternion.setFromUnitVectors(_up, _a.clone().sub(_b).normalize());
  }
}

// ------------------------------------------------------------------ 裙子
const skirtMat = new THREE.MeshPhysicalMaterial({ roughness: 0.86, side: THREE.DoubleSide, sheen: 0.15, sheenColor: 0xffffff, sheenRoughness: 0.7, bumpScale: 0.6 });
const skirt = new Skirt(skirtMat);
scene.add(skirt.mesh);
function applyPlaid() {
  const { map, bump } = makePlaid(P.plaid, renderer.capabilities.getMaxAnisotropy());
  skirtMat.map?.dispose(); skirtMat.bumpMap?.dispose();
  skirtMat.map = map; skirtMat.bumpMap = bump; skirtMat.needsUpdate = true;
  bandMat.color.set(PLAIDS[P.plaid].dark);
}

// ------------------------------------------------------------------ 姿态与动作
const act = { spin: null, sway: null, jump: null };
let time = 0, yawBase = 0;
function updatePose(dt) {
  time += dt;
  let kR = 0, kL = 0, shiftX = 0, air = 0, yaw = yawBase, crouch = 0;
  if (P.idle) {
    const ph = Math.sin(time * 0.75);
    const pr = smooth(0.15, 0.95, ph), pl = smooth(0.15, 0.95, -ph);
    kR = 0.5 * pr; kL = 0.5 * pl;
    shiftX = 0.012 * (pl - pr);
  }
  if (act.sway) {
    const t = (act.sway.t += dt), d = 3.2;
    const env = smooth(0, 0.4, t) * (1 - smooth(d - 0.6, d, t));
    shiftX += 0.085 * Math.sin(t * Math.PI * 2 * 1.15) * env;
    yaw += 0.22 * Math.sin(t * Math.PI * 2 * 1.15 + 0.6) * env;
    if (t > d) act.sway = null;
  }
  if (act.spin) {
    const t = (act.spin.t += dt), d = 1.5, u = Math.min(1, t / d);
    yaw += Math.PI * 2 * (u * u * (3 - 2 * u));
    if (t > d) { act.spin = null; yawBase += Math.PI * 2; }
  }
  if (act.jump) {
    const t = (act.jump.t += dt);
    if (t < 0.25) crouch = smooth(0, 0.25, t);
    else if (t < 0.33) crouch = 1 - smooth(0.25, 0.33, t);
    else if (t < 0.82) { const ta = t - 0.33; air = Math.max(0, 2.4 * ta - 4.9 * ta * ta); }
    else if (t < 0.95) crouch = 0.6 * smooth(0.82, 0.95, t);
    else if (t < 1.4) crouch = 0.6 * (1 - smooth(0.95, 1.4, t));
    else act.jump = null;
  }
  kR = Math.max(kR, 0.8 * crouch); kL = Math.max(kL, 0.8 * crouch);
  legs[0].foot = legs[1].foot = P.shoes ? FOOT_PITCH : 0;
  legs[0].knee = kR; legs[0].hip = kR * 0.5;
  legs[1].knee = kL; legs[1].hip = kL * 0.5;
  for (const leg of legs) leg.updateLocal();
  root.x = shiftX; root.yaw = yaw;
  root.y = -Math.min(legs[0].minY, legs[1].minY) + 0.0045 + air;
  for (const leg of legs) leg.applyRoot(root);
  bodyGroup.position.set(root.x, root.y, root.z);
  bodyGroup.rotation.y = root.yaw;
  for (const m of skinMeshes) { m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.normal.needsUpdate = true; }
}

// ------------------------------------------------------------------ 交互
const controls = (() => {
  // 先注册自己的拾取，再创建 OrbitControls，这样抓到布料时可以禁用视角旋转
  canvas.addEventListener('pointerdown', onDown);
  const c = new OrbitControls(camera, canvas);
  c.target.set(0, 0.66, 0); c.enableDamping = true; c.dampingFactor = 0.08;
  c.minDistance = 0.35; c.maxDistance = 6; c.maxPolarAngle = Math.PI * 0.62;
  c.update();
  return c;
})();
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const plane = new THREE.Plane(), hitP = new THREE.Vector3(), grabOff = new THREE.Vector3();
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff2c0, depthTest: false }));
marker.renderOrder = 10; marker.visible = false; scene.add(marker);
let drag = null;

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pick(e) {
  setRay(e);
  const objs = [skirt.mesh, ...skinMeshes];
  if (P.stockOn) objs.push(...stockings.map((s) => s.mesh));
  const hits = ray.intersectObjects(objs, false);
  for (const h of hits) {
    if (h.object === skirt.mesh) return { type: 'skirt', hit: h };
    const si = stockings.findIndex((s) => s.mesh === h.object);
    if (si >= 0) {
      if (S_ROW[Math.floor(h.face.a / NU)] < STYLES[P.style].top) continue; // 袜口以上
      return { type: 'stock', hit: h, stocking: stockings[si] };
    }
    return null; // 皮肤
  }
  return null;
}
function onDown(e) {
  if (e.button !== 0) return;
  const p = pick(e);
  if (!p) return;
  const h = p.hit;
  camera.getWorldDirection(plane.normal);
  plane.setFromNormalAndCoplanarPoint(plane.normal, h.point);
  let ok = false, target;
  if (p.type === 'skirt') { ok = skirt.grab(h.face.a, h.point); target = skirt; grabOff.set(0, 0, 0); }
  else {
    // 取命中三角形里最近的顶点
    const pa = p.stocking.pos; let best = h.face.a, bd = 1e9;
    for (const v of [h.face.a, h.face.b, h.face.c]) {
      const d = h.point.distanceToSquared(_a.set(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]));
      if (d < bd) { bd = d; best = v; }
    }
    _a.set(pa[best * 3], pa[best * 3 + 1], pa[best * 3 + 2]);
    grabOff.copy(_a).sub(h.point);
    ok = p.stocking.grab(best, _a); target = p.stocking;
  }
  if (!ok) return;
  drag = { target, id: e.pointerId };
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  marker.visible = true; marker.position.copy(h.point);
}
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  setRay(e);
  if (ray.ray.intersectPlane(plane, hitP)) {
    marker.position.copy(hitP);
    drag.target.moveGrab(_a.copy(hitP).add(grabOff));
  }
});
function endDrag() {
  if (!drag) return;
  drag.target.release(); drag = null;
  controls.enabled = true; marker.visible = false; canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------------ 面板
const gui = new GUI({ title: '参数' });
const fS = gui.addFolder('丝袜');
fS.add(P, 'stockOn').name('穿着丝袜').onChange(applyStocking);
fS.add(P, 'style', Object.keys(STYLES)).name('款式').onChange(applyStocking);
let colorCtl;
fS.add(P, 'preset', Object.keys(STOCKING_COLORS)).name('颜色预设').onChange((v) => { P.color = STOCKING_COLORS[v]; colorCtl.updateDisplay(); applyStocking(); });
colorCtl = fS.addColor(P, 'color').name('自定义颜色').onChange(applyStocking);
fS.add(P, 'denier', 5, 120, 1).name('厚度 (D 丹尼)').onChange(applyStocking);
fS.add(P, 'gloss', 0, 1, 0.01).name('光泽').onChange(applyStocking);
fS.add(P, 'tension', 0.5, 0.92, 0.01).name('松紧 (小=更紧)').onChange(applyStocking);
const fK = gui.addFolder('裙子');
fK.add(P, 'plaid', Object.keys(PLAIDS)).name('面料').onChange(applyPlaid);
fK.add(P, 'length', 0.26, 0.62, 0.01).name('裙长 (m)').onFinishChange(rebuildSkirt);
fK.add(P, 'pleats', 16, 40, 1).name('褶数').onFinishChange(rebuildSkirt);
fK.add(P, 'weight', 0.2, 1.5, 0.01).name('布料重量');
fK.add(P, 'air', 0.02, 0.8, 0.01).name('空气阻力');
const fW = gui.addFolder('风');
fW.add(P, 'wind', 0, 12, 0.1).name('风力 (m/s)');
fW.add(P, 'windDir', 0, 360, 1).name('风向 (°)');
fW.add(P, 'updraft', 0, 12, 0.1).name('上升气流');
const fA = gui.addFolder('动作');
fA.add({ f: () => { act.sway = { t: 0 }; } }, 'f').name('左右摇摆');
fA.add({ f: () => { if (!act.spin) { act.spin = { t: 0 }; } } }, 'f').name('转一圈');
fA.add({ f: () => { if (!act.jump) act.jump = { t: 0 }; } }, 'f').name('跳一下');
fA.add(P, 'idle').name('待机屈膝');
fA.add({ f: () => { act.spin = act.sway = act.jump = null; yawBase = 0; updatePose(0); skirt.reset(root); } }, 'f').name('复位');
const fB = gui.addFolder('身体');
fB.addColor(P, 'skin').name('肤色').onChange((v) => skinMat.color.set(v));
fB.add(P, 'shoes').name('高跟鞋');
fB.close();

function rebuildSkirt() { skirt.build({ pleats: P.pleats, length: P.length }, root); }

// ------------------------------------------------------------------ 主循环
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

function simulate(dt) {
  updatePose(dt);
  skirt.step(dt, root, colliders, { ...P, windDir: P.windDir * Math.PI / 180 });
  skirt.updateMesh();
  for (const s of stockings) s.update(dt);
  updateShoes();
  updateShorts();
}

applyStocking(); applyPlaid();
updatePose(0); rebuildSkirt();
for (let i = 0; i < 90; i++) { const idle = P.idle; P.idle = false; simulate(1 / 60); P.idle = idle; } // 让裙子先垂好
time = 0;

const fpsEl = document.getElementById('fps');
let last = performance.now(), acc = 0, frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  if (!P.paused) {
    acc = Math.min(acc + real, 1 / 20);
    while (acc >= 1 / 60) { simulate(1 / 60); acc -= 1 / 60; }
  }
  controls.update();
  renderer.render(scene, camera);
  frames++; fpsT += real;
  if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
}
requestAnimationFrame(frame);

// 调试 / 自动化入口
window.__app = { P, scene, camera, controls, skirt, stockings, legs, root, act, simulate, applyStocking, applyPlaid, rebuildSkirt, renderer, gui };
