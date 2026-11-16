import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeStudioEnv } from './studio.js';
import GUI from 'lil-gui';
import {
  Leg, NU, NV, SUV, S_ROW, REST, rowOfS, smooth, TOE_CUT, TOE_POS, TOE_INDEX, TOE_S,
  buildTorso, buildColliders,
  gridNormals,
} from './body.js';
import { StockingLeg, createStockingMaterial, denierToDensity, STYLES } from './stockings.js';
import { Skirt } from './skirt.js';
import { makePlaid, PLAIDS } from './textures.js';
import { createSkinMaterial, createKnitMaterial } from './materials.js';
import { makeToon, makeToonStocking, OutlinePass, makeWoodFloor } from './toon.js';
import { BODY } from './bodydata.js';
const ANKLE_P = BODY.ankle;

// ------------------------------------------------------------------ 参数
const STOCKING_COLORS = {
  '黑丝': '#0d0d11', '肉丝': '#c2957a', '白丝': '#f3f0ee', '灰丝': '#5d5d66',
  '咖啡': '#44291c', '酒红': '#5a0f20', '藏青': '#121a3a',
};
const P = {
  stockOn: true, style: '连裤袜', preset: '黑丝', color: STOCKING_COLORS['黑丝'],
  denier: 20, gloss: 0.4, shine: 0.6, seam: false, reinforce: true, tension: 0.7,
  plaid: '棕色格纹', length: 0.42, pleats: 28,
  wind: 0, windDir: 90, updraft: 0, weight: 0.6, air: 0.25,
  skin: '#eec0a8', shoes: true, idle: true, paused: false, look: window.__defaultLook || '写实',
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
scene.environment = makeStudioEnv(renderer);
scene.environmentIntensity = 0.75;

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
camera.position.set(0.55, 0.78, 2.75);

const key = new THREE.DirectionalLight(0xfff1e2, 2.3);
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
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.material.depthWrite = false; ground.renderOrder = -1; scene.add(ground);

// ------------------------------------------------------------------ 身体
const root = { x: 0, y: 0.97, z: 0, yaw: 0 };
const legs = [new Leg(1), new Leg(-1)];
const colliders = buildColliders(legs);

const skinMat = createSkinMaterial(P.skin);
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
  g.setAttribute('aSUV', new THREE.BufferAttribute(SUV, 3));
  g.setIndex(new THREE.BufferAttribute(leg.index, 1));
  g.setDrawRange(0, TOE_CUT * NU * 6);   // 再往前由真实的脚趾网格接上
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 5);
  const m = new THREE.Mesh(g, skinMat);
  m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
});

// 脚趾：真实的前脚掌网格，随腿蒙皮
const TOE_N = TOE_S.length;
const toeMeshes = legs.map((leg) => {
  const pos = new Float32Array(TOE_N * 3), col = new Float32Array(TOE_N * 3).fill(1), suv = new Float32Array(TOE_N * 3);
  for (let a = 0; a < TOE_N; a++) { suv[a * 3 + 1] = 1; suv[a * 3 + 2] = TOE_S[a]; }
  const idx = TOE_INDEX.slice();
  if (leg.side < 0) for (let k = 0; k < idx.length; k += 3) { const x = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = x; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TOE_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSUV', new THREE.BufferAttribute(suv, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 5);
  const m = new THREE.Mesh(g, skinMat);
  m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return { leg, mesh: m, pos };
});
function updateToes() {
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw), t = [0, 0, 0];
  for (const tm of toeMeshes) {
    const p = tm.pos, leg = tm.leg;
    for (let a = 0, k = 0; a < TOE_N; a++, k += 3) {
      leg.skin(TOE_POS[k], TOE_POS[k + 1], TOE_POS[k + 2], TOE_S[a], t);
      p[k] = t[0] * c + t[2] * s + root.x; p[k + 1] = t[1] + root.y; p[k + 2] = -t[0] * s + t[2] * c + root.z;
    }
    tm.mesh.geometry.attributes.position.needsUpdate = true;
    tm.mesh.geometry.computeVertexNormals();
  }
}

const bodyGroup = new THREE.Group(); scene.add(bodyGroup);
const torso = buildTorso();
const shortsMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.8 });
const topMat = createKnitMaterial(0xe8ddcc);
const bandMat = new THREE.MeshPhysicalMaterial({ color: 0x5b4336, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.45 });
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
  stockMat.roughness = 0.72 - P.gloss * 0.5;
  stockMat.envMapIntensity = 0.22 + P.gloss * 0.5; // 低光泽的丝袜几乎不反射环境，避免整体发灰
  stockMat.sheenRoughness = 0.5 - P.gloss * 0.2;
  u.uDensity.value = denierToDensity(P.denier);
  u.uGloss.value = P.gloss;
  u.uSkin.value.set(P.skin);
  u.uShine.value = P.shine; u.uSeam.value = P.seam ? 1 : 0; u.uReinf.value = P.reinforce ? 1 : 0;
  u.uFiber.value.copy(col).lerp(new THREE.Color(0xffffff), 0.7);
  u.uTop.value = st.top; u.uBand.value = st.band;
  if (typeof toon !== 'undefined') {
    const l = col.r * 0.3 + col.g * 0.5 + col.b * 0.2;
    toon.stock.color.copy(col);
    toon.stock.userData.uniforms.uShade.value.setRGB(0.55, 0.55, 0.66).lerp(new THREE.Color(0.80, 0.84, 0.97), Math.min(1, l * 1.6));
  }
  for (const s of stockings) { s.mesh.visible = P.stockOn; s.tension = P.tension; }
}

// ------------------------------------------------------------------ 鞋（乐福鞋）
// 鞋在静止姿态（腿局部坐标，脚掌平放）里建一次，之后每帧只做蒙皮：
//   鞋面 = 脚的网格外扩 + 圆鞋头，鞋口由片元遮罩裁出；横带、开口、围盖缝线是片元里的高度场（凹凸）
//   鞋底 = 鞋面俯视轮廓外放一圈沿条再向下挤出；后跟是一块方跟，穿鞋时脚踝相应跖屈
const SHOE_J0 = rowOfS(0.80), SHOE_ROWS = NV - SHOE_J0, SHOE_N = NU * SHOE_ROWS;
const HEEL_PITCH = 0.16;            // 穿鞋时的脚踝跖屈角（约 3cm 的跟）
const SOLE_T = 0.007, WELT = 0.0032;
const SHOE_MASK = `      if (vSUV.x < 0.) discard;   // 鞋口：aSUV.x 里存的是“在鞋帮上沿以下多少”
`;
const shoeMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.07, side: THREE.DoubleSide });
shoeMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aSUV; attribute vec3 aShoe; varying vec3 vSUV; varying vec3 vShoe;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUV = aSUV; vShoe = aShoe;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vSUV; varying vec3 vShoe;
      float lfSlit;
      // 皮面上的起伏（米）。u：沿鞋长 0..1，v：横向 -1..1，d：俯视图里离鞋面轮廓的距离
      float loaferHeight(float u, float v, float d) {
        float strap = smoothstep(.515, .521, u) * (1. - smoothstep(.625, .631, u));          // 马鞍横带
        lfSlit = strap * (1. - smoothstep(.007, .010, abs(u - .572))) * (1. - smoothstep(.34, .40, abs(v)));
        float groove = (1. - smoothstep(0., .0035, abs(u - .528))) + (1. - smoothstep(0., .0035, abs(u - .618)));
        float hgt = strap * .0014 - lfSlit * .0017 - groove * strap * .0003;
        // 鞋头围盖：离轮廓一圈的凸棱，上面压着一针一针的缝线
        float ridge = exp(-pow((d - .0125) / .0030, 2.)) * smoothstep(.630, .642, u);
        float stitch = .88 + .12 * sin(atan(v, (u - .70) * 3.2) * 40.);
        return hgt + ridge * .0011 * stitch;
      }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
${SHOE_MASK}
      float lfH = loaferHeight(vSUV.y, vSUV.z, vShoe.x);
      float lfS = lfSlit;
      diffuseColor.rgb *= 1. - .65 * lfS;
      if (!gl_FrontFacing) diffuseColor.rgb = vec3(.36, .29, .23);   // 内里`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (gl_FrontFacing) {
        // 前向差分（而不是直接对高度求屏幕导数）：属性的导数在三角形内是常数，结果逐像素准确，不会出现 2x2 的马赛克
        vec3 qa = vec3(vSUV.yz, vShoe.x), qx = dFdx(qa), qy = dFdy(qa);
        vec2 dH = vec2(loaferHeight(qa.x + qx.x, qa.y + qx.y, qa.z + qx.z), loaferHeight(qa.x + qy.x, qa.y + qy.y, qa.z + qy.z)) - lfH;
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1) * faceDirection;
        normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
      }`)
    .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\nclearcoatNormal = normal;');
};
const soleMat = new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 0.82, envMapIntensity: 0.3 });
const SHOE_REST = new Float32Array(SHOE_N * 3), SHOE_COL = new Float32Array(SHOE_N * 3);
const SHOE_SUV = new Float32Array(SHOE_N * 3);   // (鞋口遮罩, u, v)
const SHOE_AUX = new Float32Array(SHOE_N * 3);   // (d, h, 0)
const SHOE_S = new Float32Array(SHOE_N);         // 蒙皮用的 s（靠近鞋底的部分随鞋底刚性运动）
const SOLE_K = 96;
let SOLE_REST, SOLE_S, SOLE_INDEX, SHOE_DROP = 0;
(function buildLoafer() {
  const rn = new Float32Array(NU * NV * 3); gridNormals(REST, rn, NU, NV);
  const p = SHOE_REST, off = SHOE_J0 * NU * 3, TOE_J0 = rowOfS(0.93) - SHOE_J0, y0 = BODY.restMinY;
  const win = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));
  for (let j = 0; j < SHOE_ROWS; j++) {
    const s = S_ROW[SHOE_J0 + j], o = 0.0036 + 0.0055 * smooth(0.92, 0.99, s);
    for (let k = j * NU * 3; k < (j + 1) * NU * 3; k++) p[k] = REST[off + k] + rn[off + k] * o;
  }
  // 鞋头：把脚趾的起伏抹平成光滑的鞋面
  const tmp = new Float32Array(p.length);
  for (let pass = 0; pass < 40; pass++) {
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
  // 抹平会让鞋头向内收缩，这里保证鞋面始终在脚的外侧
  for (let k = TOE_J0 * NU * 3; k < p.length; k += 3) {
    const d = (p[k] - REST[off + k]) * rn[off + k] + (p[k + 1] - REST[off + k + 1]) * rn[off + k + 1] + (p[k + 2] - REST[off + k + 2]) * rn[off + k + 2];
    if (d < 0.003) { const e = 0.003 - d; p[k] += rn[off + k] * e; p[k + 1] += rn[off + k + 1] * e; p[k + 2] += rn[off + k + 2] * e; }
  }
  let z0 = 1e9, z1 = -1e9;
  for (let k = 2; k < p.length; k += 3) { if (p[k] < z0) z0 = p[k]; if (p[k] > z1) z1 = p[k]; }
  const rowW = (j) => { let cx = 0, w = 0; for (let i = 0; i < NU; i++) cx += p[(j * NU + i) * 3] / NU; for (let i = 0; i < NU; i++) w = Math.max(w, Math.abs(p[(j * NU + i) * 3] - cx)); return [cx, w]; };
  { // 鞋头：不跟着脚趾的形状走（脚尖是斜的、网格在趾尖汇成一点），而是把前掌处的一圈截面
    // 沿鞋长按楦型曲线逐渐收小，放样出一个圆润的鞋头
    const U0 = 0.66, zc = z0 + (z1 - z0) * U0, y0 = BODY.restMinY;
    let jb = 0; for (let j = 0; j < SHOE_ROWS; j++) { let z = 0; for (let i = 0; i < NU; i++) z += p[(j * NU + i) * 3 + 2] / NU; if (z < zc) jb = j + 1; }
    const ob = jb * NU * 3, L = z1 - zc + 0.014, last = SHOE_ROWS - 1;
    let xa = 1e9, xb = -1e9; for (let i = 0; i < NU; i++) { xa = Math.min(xa, p[ob + i * 3]); xb = Math.max(xb, p[ob + i * 3]); }
    const cx = (xa + xb) / 2;
    for (let j = jb + 1; j <= last; j++) {
      const t = (j - jb) / (last - jb), e = Math.sin(t * Math.PI / 2) * 0.999;
      const ws = Math.pow(1 - Math.pow(e, 2.3), 1 / 2.3), hs = Math.pow(1 - Math.pow(e, 2.6), 1 / 2.6) * (1 - 0.22 * e);
      for (let i = 0; i < NU; i++) {
        const k = (j * NU + i) * 3, b = ob + i * 3;
        p[k] = cx + (p[b] - cx) * ws; p[k + 1] = y0 + (p[b + 1] - y0) * hs; p[k + 2] = zc + (p[b + 2] - zc) * (1 - e) + L * e;
      }
    }
    // 放样出来的鞋头必须把脚（连同丝袜）包在里面：逐行检查，哪一行不够大就把那一行放大
    const fac = new Float32Array(SHOE_ROWS).fill(1);
    for (let j = jb + 1; j < last; j++) {
      let zr = 0, yc = 0; for (let i = 0; i < NU; i++) { zr += p[(j * NU + i) * 3 + 2] / NU; yc += p[(j * NU + i) * 3 + 1] / NU; }
      const ring = []; for (let i = 0; i < NU; i++) { const k = (j * NU + i) * 3; ring.push([Math.atan2(p[k + 1] - yc, p[k] - cx), Math.hypot(p[k] - cx, p[k + 1] - yc)]); }
      ring.sort((a, b) => a[0] - b[0]);
      const rad = (ang) => { let i = 0; while (i < NU && ring[i][0] < ang) i++; const a = ring[(i + NU - 1) % NU], b = ring[i % NU]; let da = b[0] - a[0], dq = ang - a[0]; if (da <= 0) da += Math.PI * 2; if (dq < 0) dq += Math.PI * 2; return a[1] + (b[1] - a[1]) * Math.min(1, dq / da); };
      for (let k = off; k < REST.length; k += 3) {
        if (Math.abs(REST[k + 2] - zr) > 0.004) continue;
        const x = REST[k] + rn[k] * 0.001 - cx, y = REST[k + 1] + rn[k + 1] * 0.001 - yc;
        fac[j] = Math.max(fac[j], (Math.hypot(x, y) + 0.0025) / rad(Math.atan2(y, x)));
      }
    }
    for (let pass = 0; pass < 3; pass++) { const c = fac.slice(); for (let j = jb + 1; j < last; j++) fac[j] = pass === 0 ? Math.max(c[j - 1], c[j], c[j + 1]) : (c[j - 1] + 2 * c[j] + c[j + 1]) / 4; }
    for (let j = jb + 1; j < last; j++) for (let i = 0; i < NU; i++) { const k = (j * NU + i) * 3; p[k] = cx + (p[k] - cx) * fac[j]; p[k + 1] = y0 + (p[k + 1] - y0) * fac[j]; }
    z1 = -1e9; for (let k = 2; k < p.length; k += 3) if (p[k] > z1) z1 = p[k];
  }
  // 鞋口。u：沿脚长（0 = 脚跟后缘，1 = 鞋尖），v：横向，h：离脚底的高度
  const base = new THREE.Color(0x2c1215);
  for (let j = 0; j < SHOE_ROWS; j++) {
    const sr = S_ROW[SHOE_J0 + j], [cx, w] = rowW(j);
    for (let i = 0; i < NU; i++) {
      const a = j * NU + i, k = a * 3;
      const u = (p[k + 2] - z0) / (z1 - z0), h = p[k + 1] - y0, v = (p[k] - cx) / Math.max(w, 1e-4);
      // 鞋帮上沿：后跟高、两侧低，向前升到脚背；再往前整圈包住，中间是向后伸出的鞋舌
      const top = 0.054 + (0.036 - 0.054) * smooth(0.04, 0.30, u) + 0.05 * smooth(0.36, 0.50, u);
      const uFront = 0.50 - 0.06 * Math.max(0, 1 - v * v * v * v * 2.2);
      SHOE_SUV[k] = Math.max(top - h, Math.min((u - uFront) * 0.4, 0.088 - h));
      SHOE_SUV[k + 1] = u; SHOE_SUV[k + 2] = v;
      SHOE_AUX[k + 1] = h;
      SHOE_S[a] = sr + (Math.max(sr, 0.9) - sr) * (1 - smooth(0.012, 0.045, h));
      SHOE_COL[k] = base.r; SHOE_COL[k + 1] = base.g; SHOE_COL[k + 2] = base.b;
    }
  }
  // ---- 鞋面的俯视轮廓：凸包 -> 按弧长均匀重采样 ----
  const pts = [];
  for (let k = 0; k < p.length; k += 3) if (p[k + 1] - y0 < 0.03 && SHOE_SUV[k] > 0) pts.push([p[k], p[k + 2]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), hull = [];
  for (const q of pts) { while (hull.length >= 2 && cr(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop(); hull.push(q); }
  const lo = hull.length + 1;
  for (let i = pts.length - 2; i >= 0; i--) { const q = pts[i]; while (hull.length >= lo && cr(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop(); hull.push(q); }
  hull.pop();
  const K = SOLE_K, len = [0];
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const loop = [];
  for (let m = 0, i = 0; m < K; m++) {
    const d = m / K * len[hull.length]; while (len[i + 1] < d) i++;
    const a = hull[i], b = hull[(i + 1) % hull.length], f = (d - len[i]) / (len[i + 1] - len[i]);
    loop.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  for (let pass = 0; pass < 3; pass++) { const c = loop.map((q) => q.slice()); for (let m = 0; m < K; m++) for (let e = 0; e < 2; e++) loop[m][e] = (c[m][e] * 2 + c[(m + 1) % K][e] + c[(m + K - 1) % K][e]) / 4; }
  // 每个鞋面顶点在俯视图里离轮廓的距离（围盖缝线用）
  for (let k = 0; k < p.length; k += 3) {
    let best = 1e9;
    for (let m = 0; m < K; m++) {
      const a = loop[m], b = loop[(m + 1) % K], ex = b[0] - a[0], ez = b[1] - a[1];
      const t = Math.min(1, Math.max(0, ((p[k] - a[0]) * ex + (p[k + 2] - a[1]) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(p[k] - a[0] - ex * t, p[k + 2] - a[1] - ez * t));
    }
    SHOE_AUX[k] = best;
  }
  // ---- 鞋底 ----
  let cx = 0, cz = 0; for (const q of loop) { cx += q[0] / K; cz += q[1] / K; }
  // 凸包（x, z）逆时针时，外法线是 (dz, -dx)
  const out = loop.map((q, m) => {
    const a = loop[(m + K - 1) % K], b = loop[(m + 1) % K]; const nx = b[1] - a[1], nz = -(b[0] - a[0]), l = Math.hypot(nx, nz) || 1;
    return [q[0] + nx / l * WELT, q[1] + nz / l * WELT];
  });
  // 鞋底顶点的 s：按 z 从脚的各行查出来；脚掌以后的部分整体随脚踝刚性运动（s = 0.9）
  const jr = rowOfS(0.9), zRow = [];
  for (let j = jr; j < NV; j++) { let z = 0; for (let i = 0; i < NU; i++) z += REST[(j * NU + i) * 3 + 2] / NU; zRow.push(z); }
  const sOfZ = (z) => {
    if (z <= zRow[0]) return 0.9;
    for (let n = 1; n < zRow.length; n++) if (z <= zRow[n]) return S_ROW[jr + n - 1] + (S_ROW[jr + n] - S_ROW[jr + n - 1]) * (z - zRow[n - 1]) / Math.max(zRow[n] - zRow[n - 1], 1e-6);
    return S_ROW[NV - 1];
  };
  const yT = y0 + 0.003, yB = y0 - SOLE_T;
  const V = [], Sv = [], idx = [], add = (x, y, z, s) => { V.push(x, y, z); Sv.push(s); return Sv.length - 1; };
  // 0..K-1 沿条上缘，K..2K-1 侧壁下缘，2K..3K-1 底面外圈，3K 底面中心，3K+1.. 沿条顶面内圈
  for (const q of out) add(q[0], yT, q[1], sOfZ(q[1]));
  for (const q of out) add(q[0], yB, q[1], sOfZ(q[1]));
  for (const q of out) add(q[0], yB, q[1], sOfZ(q[1]));
  add(cx, yB, cz, sOfZ(cz));
  for (const q of loop) add(q[0] + (cx - q[0]) * 0.25, yT, q[1] + (cz - q[1]) * 0.25, sOfZ(q[1]));
  for (let m = 0; m < K; m++) {
    const m1 = (m + 1) % K;
    idx.push(m, m1, K + m, m1, K + m1, K + m);                                   // 侧壁
    idx.push(2 * K + m, 2 * K + m1, 3 * K);                                      // 底面
    idx.push(3 * K + 1 + m, m1, m, 3 * K + 1 + m, 3 * K + 1 + m1, m1);           // 沿条顶面
  }
  // ---- 方跟：鞋底后段向下的一块，底面在站姿（脚踝跖屈 HEEL_PITCH）时刚好水平着地 ----
  const leg = legs[0], t = [0, 0, 0];
  leg.foot = HEEL_PITCH;
  let gY = 1e9, fY = 1e9;
  for (let m = K; m < 2 * K; m++) gY = Math.min(gY, leg.skin(V[m * 3], V[m * 3 + 1], V[m * 3 + 2], Sv[m], t)[1]);
  for (let j = SHOE_J0; j < NV; j++) for (let i = 0; i < NU; i++) { const k = (j * NU + i) * 3; fY = Math.min(fY, leg.skin(REST[k], REST[k + 1], REST[k + 2], S_ROW[j], t)[1]); }
  SHOE_DROP = fY - gY;
  const rear = []; let start = 0;
  const isRear = (m) => (out[m][1] - z0) / (z1 - z0) < 0.27;
  for (let m = 0; m < K; m++) if (isRear(m) && !isRear((m + K - 1) % K)) start = m;
  for (let n = 0; n < K && isRear((start + n) % K); n++) rear.push((start + n) % K);
  const M = rear.length, A = ANKLE_P, ca = Math.cos(HEEL_PITCH), sa = Math.sin(HEEL_PITCH), h0 = Sv.length;
  for (const m of rear) add(out[m][0], yB, out[m][1], 0.9);
  const bot = rear.map((m) => {
    leg.skin(out[m][0], yB, out[m][1], 0.9, t);
    const py = gY - A[1], pz = t[2] - A[2];       // 竖直投到地面，再反算回静止姿态
    return [out[m][0], py * ca + pz * sa + A[1], -py * sa + pz * ca + A[2]];
  });
  for (const q of bot) add(q[0], q[1], q[2], 0.9);
  for (const q of bot) add(q[0], q[1], q[2], 0.9);
  const hc = add(bot.reduce((a, q) => a + q[0] / M, 0), bot.reduce((a, q) => a + q[1] / M, 0), bot.reduce((a, q) => a + q[2] / M, 0), 0.9);
  for (let n = 0; n < M; n++) {
    const n1 = (n + 1) % M;
    idx.push(h0 + n, h0 + n1, h0 + M + n, h0 + n1, h0 + M + n1, h0 + M + n);
    idx.push(h0 + 2 * M + n, h0 + 2 * M + n1, hc);
  }
  leg.foot = 0;
  SOLE_REST = new Float32Array(V); SOLE_S = new Float32Array(Sv); SOLE_INDEX = idx;
})();
const shoes = legs.map((leg) => {
  const pos = new Float32Array(SHOE_N * 3), nrm = new Float32Array(SHOE_N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(SHOE_COL, 3));
  g.setAttribute('aSUV', new THREE.BufferAttribute(SHOE_SUV, 3));
  g.setAttribute('aShoe', new THREE.BufferAttribute(SHOE_AUX, 3));
  const idx = [];
  for (let j = 0; j < SHOE_ROWS - 1; j++) for (let i = 0; i < NU; i++) {
    const a = j * NU + i, b = j * NU + (i + 1) % NU, c = a + NU, d = b + NU;
    if (leg.side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 5);
  const mesh = new THREE.Mesh(g, shoeMat); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  // 鞋底 + 方跟
  const sg = new THREE.BufferGeometry(), si = SOLE_INDEX.slice();
  if (leg.side < 0) for (let k = 0; k < si.length; k += 3) { const x = si[k + 1]; si[k + 1] = si[k + 2]; si[k + 2] = x; }
  const spos = new Float32Array(SOLE_REST.length);
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setIndex(si);
  sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 5);
  const sole = new THREE.Mesh(sg, soleMat); sole.frustumCulled = false; sole.castShadow = true; sole.receiveShadow = true;
  scene.add(mesh, sole);
  return { leg, mesh, sole, spos, pos, nrm };
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
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _t = [0, 0, 0];
function localToWorld(t, out) {
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
  return out.set(t[0] * c + t[2] * s + root.x, t[1] + root.y, -t[0] * s + t[2] * c + root.z);
}
function updateShoes() {
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw), t = _t;
  for (const sh of shoes) {
    sh.mesh.visible = sh.sole.visible = P.shoes;
    if (!P.shoes) continue;
    const p = sh.pos, leg = sh.leg;
    for (let a = 0, k = 0; a < SHOE_N; a++, k += 3) {
      leg.skin(SHOE_REST[k], SHOE_REST[k + 1], SHOE_REST[k + 2], SHOE_S[a], t);
      p[k] = t[0] * c + t[2] * s + root.x; p[k + 1] = t[1] + root.y; p[k + 2] = -t[0] * s + t[2] * c + root.z;
    }
    gridNormals(p, sh.nrm, NU, SHOE_ROWS);
    if (leg.side < 0) for (let k = 0; k < sh.nrm.length; k++) sh.nrm[k] = -sh.nrm[k];
    sh.mesh.geometry.attributes.position.needsUpdate = true;
    sh.mesh.geometry.attributes.normal.needsUpdate = true;
    const sp = sh.spos;
    for (let a = 0, k = 0; k < sp.length; a++, k += 3) {
      leg.skin(SOLE_REST[k], SOLE_REST[k + 1], SOLE_REST[k + 2], SOLE_S[a], t);
      sp[k] = t[0] * c + t[2] * s + root.x; sp[k + 1] = t[1] + root.y; sp[k + 2] = -t[0] * s + t[2] * c + root.z;
    }
    sh.sole.geometry.attributes.position.needsUpdate = true;
    sh.sole.geometry.computeVertexNormals();
  }
}

// ------------------------------------------------------------------ 裙子
const skirtMat = new THREE.MeshPhysicalMaterial({ roughness: 0.9, side: THREE.DoubleSide, vertexColors: true, sheen: 0.45, sheenColor: 0xffffff, sheenRoughness: 0.8, bumpScale: 1.6 });
const skirt = new Skirt(skirtMat);
scene.add(skirt.mesh);
function applyPlaid() {
  const { map, bump } = makePlaid(P.plaid, renderer.capabilities.getMaxAnisotropy());
  skirtMat.map?.dispose(); skirtMat.bumpMap?.dispose();
  skirtMat.map = map; skirtMat.bumpMap = bump; skirtMat.needsUpdate = true;
  bandMat.color.set(PLAIDS[P.plaid].dark);
  skirtMat.sheenColor.set(PLAIDS[P.plaid].base).lerp(new THREE.Color(0xffffff), 0.5);
  if (typeof toon !== 'undefined') { toon.skirt.map = map; toon.skirt.needsUpdate = true; toon.band.color.set(PLAIDS[P.plaid].dark); }
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
  legs[0].foot = legs[1].foot = P.shoes ? HEEL_PITCH : 0;
  legs[0].knee = kR; legs[0].hip = kR * 0.5;
  legs[1].knee = kL; legs[1].hip = kL * 0.5;
  for (const leg of legs) leg.updateLocal();
  root.x = shiftX; root.yaw = yaw;
  root.y = -Math.min(legs[0].minY, legs[1].minY) + (P.shoes ? SHOE_DROP + 0.0005 : 0.0045) + air;
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
  if (P.shoes) for (const sh of shoes) objs.push(sh.mesh, sh.sole);
  const hits = ray.intersectObjects(objs, false);
  for (const h of hits) {
    if (h.object === skirt.mesh) return { type: 'skirt', hit: h };
    const shoe = shoes.find((sh) => sh.mesh === h.object || sh.sole === h.object);
    if (shoe) {
      // 鞋不能被拉拽，也挡住鞋里面的丝袜；鞋面网格在鞋口以上的部分是被遮罩裁掉的，不算
      if (h.object === shoe.sole || SHOE_SUV[h.face.a * 3] > 0 || SHOE_SUV[h.face.b * 3] > 0 || SHOE_SUV[h.face.c * 3] > 0) return null;
      continue;
    }
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

// ------------------------------------------------------------------ 渲染风格（写实 / 动画）
const toon = {
  skin: makeToon({ color: P.skin, vertexColors: true, shade: [0.97, 0.72, 0.62], edge: [1.0, 0.90, 0.85], rim: [0.30, 0.24, 0.20], soft: 0.06, streak: 0.95, specPow: 14 }),
  skirt: makeToon({ side: THREE.DoubleSide, shade: [0.72, 0.70, 0.86], rim: [0.10, 0.10, 0.12] }),
  top: makeToon({ color: 0xfbf8f2, shade: [0.80, 0.83, 0.96], rim: [0.06, 0.06, 0.08] }),
  band: makeToon({ color: 0x5b4336, shade: [0.62, 0.58, 0.70] }),
  shorts: makeToon({ color: 0x1b1b22, shade: [0.6, 0.6, 0.75] }),
  shoe: makeToon({ vertexColors: true, side: THREE.DoubleSide, shade: [0.62, 0.52, 0.62], rim: [0.20, 0.14, 0.10], mask: SHOE_MASK }),
  sole: makeToon({ color: 0x18130f, shade: [0.6, 0.55, 0.65] }),
  stock: makeToonStocking(stockMat.userData.uniforms),
};
toon.skin.polygonOffset = true; toon.skin.polygonOffsetFactor = 1; toon.skin.polygonOffsetUnits = 1;
const outline = new OutlinePass(renderer);
const woodFloor = makeWoodFloor(); scene.add(woodFloor);
const looks = [
  ...skinMeshes.map((m) => [m, skinMat, toon.skin]),
  ...toeMeshes.map((t) => [t.mesh, skinMat, toon.skin]),
  ...stockings.map((s) => [s.mesh, stockMat, toon.stock]),
  ...shoes.flatMap((sh) => [[sh.mesh, shoeMat, toon.shoe], [sh.sole, soleMat, toon.sole]]),
  ...shortLegs.map((sh) => [sh.mesh, shortsMat, toon.shorts]),
  ...bodyGroup.children.map((m) => [m, m.material, m.material === topMat ? toon.top : m.material === bandMat ? toon.band : toon.shorts]),
  [skirt.mesh, skirtMat, toon.skirt],
];
function applyLook() {
  const t = P.look === '动画';
  for (const [mesh, real, tn] of looks) mesh.material = t ? tn : real;
  scene.background.set(t ? 0xfbfaf8 : 0x15161b);
  woodFloor.visible = t;
  renderer.toneMapping = t ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  ground.material.opacity = t ? 0.30 : 0.45;
  ground.material.color.set(t ? 0x6b3a1c : 0x000000);
  document.body.classList.toggle('toon', t);
}

// ------------------------------------------------------------------ 面板
const gui = new GUI({ title: '参数' });
gui.add(P, 'look', ['写实', '动画']).name('渲染风格').onChange(applyLook);
gui.add(P, 'shoes').name('穿鞋子');
const fS = gui.addFolder('丝袜');
fS.add(P, 'stockOn').name('穿着丝袜').onChange(applyStocking);
fS.add(P, 'style', Object.keys(STYLES)).name('款式').onChange(applyStocking);
let colorCtl;
fS.add(P, 'preset', Object.keys(STOCKING_COLORS)).name('颜色预设').onChange((v) => { P.color = STOCKING_COLORS[v]; colorCtl.updateDisplay(); applyStocking(); });
colorCtl = fS.addColor(P, 'color').name('自定义颜色').onChange(applyStocking);
fS.add(P, 'denier', 5, 120, 1).name('厚度 (D 丹尼)').onChange(applyStocking);
fS.add(P, 'gloss', 0, 1, 0.01).name('光泽').onChange(applyStocking);
fS.add(P, 'shine', 0, 1.5, 0.01).name('丝光条纹').onChange(applyStocking);
fS.add(P, 'reinforce').name('加固袜尖 / 脚跟').onChange(applyStocking);
fS.add(P, 'seam').name('背缝线').onChange(applyStocking);
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
fB.addColor(P, 'skin').name('肤色').onChange((v) => { skinMat.color.set(v); toon.skin.color.set(v); applyStocking(); });
fB.close();

function rebuildSkirt() { skirt.build({ pleats: P.pleats, length: P.length }, root); }

// ------------------------------------------------------------------ 主循环
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  outline.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

function simulate(dt) {
  updatePose(dt);
  skirt.step(dt, root, colliders, { ...P, windDir: P.windDir * Math.PI / 180 });
  skirt.updateMesh();
  for (const s of stockings) s.update(dt);
  updateToes();
  updateShoes();
  updateShorts();
}

applyStocking(); applyPlaid(); applyLook();
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
  if (P.look === '动画') outline.render(scene, camera); else renderer.render(scene, camera);
  frames++; fpsT += real;
  if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
}
requestAnimationFrame(frame);

// 调试 / 自动化入口
window.__app = { applyLook, toon, P, scene, camera, controls, skirt, stockings, legs, root, act, simulate, applyStocking, applyPlaid, rebuildSkirt, renderer, gui };
