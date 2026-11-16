// 把 MakeHuman 基础网格（CC0）重采样成本项目使用的规则网格：
//   腿：NU×NV 的 (θ, s) 网格（丝袜模拟、蒙皮、鞋都依赖这个拓扑）；采样前先对源网格做 Catmull-Clark 细分
//   骨盆/躯干：水平环 + 底部半球
// 用法: node tools/fit-body.mjs   ->  生成 src/bodydata.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NU = 64, NV = 200, LEG_LEN = 1.079, KNEE_S = 0.42, ANKLE_S = 0.82;
const SCALE = 0.1;                 // MakeHuman 单位是分米
const ANKLE_X = 0.058;             // 站姿：脚踝离身体中线的距离
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- 读取 OBJ
const V = [], groups = {};
let g = null;
for (const line of fs.readFileSync(path.join(ROOT, 'assets/makehuman/base.obj'), 'utf8').split('\n')) {
  if (line.startsWith('v ')) { const p = line.split(/\s+/); V.push([+p[1] * SCALE, +p[2] * SCALE, +p[3] * SCALE]); }
  else if (line.startsWith('g ')) g = line.split(/\s+/)[1];
  else if (line.startsWith('f ')) (groups[g] ||= []).push(line.trim().split(/\s+/).slice(1).map((t) => parseInt(t) - 1));
}
const cen = (name) => {
  const s = new Set(groups[name].flat()); const c = [0, 0, 0];
  for (const i of s) for (let k = 0; k < 3; k++) c[k] += V[i][k] / s.size;
  return c;
};
const groundY = cen('joint-ground')[1];
const H = cen('joint-l-upper-leg'), K = cen('joint-l-knee'), A = cen('joint-l-ankle');
// 身体局部坐标：髋关节高度为 y=0，髋关节所在的冠状面为 z=0
const OY = H[1], OZ = H[2];
const tr = (p) => [p[0], p[1] - OY, p[2] - OZ];
// ---------------------------------------------------------------- Catmull-Clark 细分
// 基础网格很粗（腿上一个四边形有 2~3cm），直接求交会把平面的棱角采进规则网格。
// MakeHuman 的网格本来就是按细分曲面设计的，这里先细分 SUBDIV 次再采样。
function catmullClark(P, F) {
  const nP = P.length, fp = F.map((f) => { const c = [0, 0, 0]; for (const i of f) for (let k = 0; k < 3; k++) c[k] += P[i][k] / f.length; return c; });
  const edges = new Map(), ekey = (a, b) => (a < b ? a * nP + b : b * nP + a);
  F.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = ekey(a, b);
    let e = edges.get(key); if (!e) edges.set(key, e = { a, b, f: [] }); e.f.push(fi);
  }));
  const out = P.map((p) => p.slice());
  const fSum = P.map(() => [0, 0, 0, 0]), eSum = P.map(() => [0, 0, 0, 0]), bSum = P.map(() => [0, 0, 0, 0]);
  F.forEach((f, fi) => { for (const i of f) { for (let k = 0; k < 3; k++) fSum[i][k] += fp[fi][k]; fSum[i][3]++; } });
  for (const e of edges.values()) {
    const mid = [0, 1, 2].map((k) => (P[e.a][k] + P[e.b][k]) / 2), sharp = e.f.length !== 2; // 边界（眼眶、口腔开口）按折痕处理
    e.i = out.length;
    out.push(sharp ? mid : [0, 1, 2].map((k) => (P[e.a][k] + P[e.b][k] + fp[e.f[0]][k] + fp[e.f[1]][k]) / 4));
    for (const v of [e.a, e.b]) {
      const acc = sharp ? bSum[v] : eSum[v], o = v === e.a ? e.b : e.a;
      if (sharp) { for (let k = 0; k < 3; k++) acc[k] += P[o][k]; } else for (let k = 0; k < 3; k++) acc[k] += mid[k];
      acc[3]++;
    }
  }
  for (let i = 0; i < nP; i++) {
    const b = bSum[i], n = fSum[i][3];
    if (b[3] === 2) for (let k = 0; k < 3; k++) out[i][k] = (6 * P[i][k] + b[k]) / 8;
    else if (b[3] === 0 && n >= 3 && eSum[i][3] === n) for (let k = 0; k < 3; k++) out[i][k] = (fSum[i][k] / n + 2 * eSum[i][k] / n + (n - 3) * P[i][k]) / n;
  }
  const nF = [];
  F.forEach((f, fi) => {
    const c = out.length; out.push(fp[fi]);
    f.forEach((a, k) => nF.push([a, edges.get(ekey(a, f[(k + 1) % f.length])).i, c, edges.get(ekey(f[(k + f.length - 1) % f.length], a)).i]));
  });
  return [out, nF];
}
const SUBDIV = 2;
let bodyP, bodyF;
{
  const map = new Map(); bodyP = [];
  bodyF = groups.body.map((f) => f.map((i) => { let m = map.get(i); if (m === undefined) { m = bodyP.length; map.set(i, m); bodyP.push(tr(V[i])); } return m; }));
  for (let l = 0; l < SUBDIV; l++) [bodyP, bodyF] = catmullClark(bodyP, bodyF);
}
const tris = [];
for (const f of bodyF) for (let k = 1; k < f.length - 1; k++) tris.push([bodyP[f[0]], bodyP[f[k]], bodyP[f[k + 1]]]);
console.log('subdivided body:', bodyP.length, 'verts', tris.length, 'tris');
const hip = tr(H), knee = tr(K), ankle = tr(A), gy = groundY - OY;
console.log('height', (Math.max(...groups.body.flat().map((i) => V[i][1])) - groundY).toFixed(3), 'hip', hip, 'knee', knee, 'ankle', ankle, 'ground', gy.toFixed(3));

// ---------------------------------------------------------------- 射线求交
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function makeCaster(list) {
  const pre = list.map(([a, b, c]) => ({ a, e1: sub(b, a), e2: sub(c, a) }));
  // 按高度分桶：射线只和它经过的高度范围内的三角形求交
  const BIN = 0.01, y0 = Math.min(...list.map((t) => Math.min(t[0][1], t[1][1], t[2][1])));
  const bins = [], bin = (y) => Math.floor((y - y0) / BIN);
  list.forEach((t, i) => {
    const lo = bin(Math.min(t[0][1], t[1][1], t[2][1])), hi = bin(Math.max(t[0][1], t[1][1], t[2][1]));
    for (let b = lo; b <= hi; b++) (bins[b] ||= []).push(pre[i]);
  });
  return (o, d, maxT) => {
    let best = maxT;
    const ya = o[1], yb = o[1] + d[1] * maxT;
    const b0 = Math.max(0, bin(Math.min(ya, yb))), b1 = Math.min(bins.length - 1, bin(Math.max(ya, yb)));
    for (let b = b0; b <= b1; b++) for (const t of bins[b] || []) {
      const p = cross(d, t.e2), det = dot(t.e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, s = sub(o, t.a), u = dot(s, p) * inv;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const q = cross(s, t.e1), v = dot(d, q) * inv;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const tt = dot(t.e2, q) * inv;
      if (tt > 1e-5 && tt < best) best = tt;
    }
    return best;
  };
}
const legCast = makeCaster(tris.filter((t) => t.some((p) => p[0] > -0.02) && t.some((p) => p[1] < 0.12)));

// ---------------------------------------------------------------- 腿的脊线
const toeTipZ = Math.max(...tris.flat().filter((p) => p[0] > 0 && p[1] < gy + 0.06).map((p) => p[2]));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const fx = ankle[0] - 0.006;
// 脚踝处脊线走一段圆弧（圆心在脚背折痕处），避免截面在脚背内侧互相交叉
// 折痕点：从踝关节向前上方各方向求交，取最近的表面点
let PZ = 0, PY = 0, AR = 1e9;
for (let a = 0; a <= 70; a += 2) {
  const d = [0, Math.sin(a * Math.PI / 180), Math.cos(a * Math.PI / 180)], t = legCast(ankle, d, 0.2);
  if (t < AR) { AR = t; PY = ankle[1] + d[1] * t; PZ = ankle[2] + d[2] * t; }
}
{ const k = (AR + 0.007) / AR; PY = ankle[1] + (PY - ankle[1]) * k; PZ = ankle[2] + (PZ - ankle[2]) * k; AR += 0.007; } // 圆心放到皮肤外一点，截面永不相交
console.log('instep crease dist', AR.toFixed(4), 'dy', (PY - ankle[1]).toFixed(4), 'dz', (PZ - ankle[2]).toFixed(4));
let ctrl = [
  [0, ...hip], [0.21, ...lerp3(hip, knee, 0.5)], [KNEE_S, ...knee],
  [0.56, ...lerp3(knee, ankle, 0.35)], [0.68, ...lerp3(knee, ankle, 0.65)], [0.75, ...lerp3(knee, ankle, 0.84)],
  [0.80, ankle[0], PY + 0.002, PZ - AR],
  [0.835, ankle[0] - 0.002, PY - AR * 0.707, PZ - AR * 0.707],
  [0.87, fx, PY - AR, PZ + 0.002],
  [0.94, fx, gy + 0.027, ankle[2] + 0.100],
  [1.00, fx, gy + 0.018, toeTipZ - 0.070],
  [1.05, fx, gy + 0.013, toeTipZ - 0.031],
  [LEG_LEN, fx, gy + 0.011, toeTipZ - 0.008],
];
function sampleTable(table, s) {
  const n = table.length, cols = table[0].length - 1, out = new Array(cols);
  if (s <= table[0][0]) return table[0].slice(1);
  if (s >= table[n - 1][0]) return table[n - 1].slice(1);
  let i = 0; while (table[i + 1][0] < s) i++;
  const p1 = table[i], p2 = table[i + 1], p0 = table[Math.max(i - 1, 0)], p3 = table[Math.min(i + 2, n - 1)];
  const h = p2[0] - p1[0], t = (s - p1[0]) / h, t2 = t * t, t3 = t2 * t;
  for (let c = 1; c <= cols; c++) {
    const m1 = (p2[c] - p0[c]) / (p2[0] - p0[0]), m2 = (p3[c] - p1[c]) / (p3[0] - p1[0]);
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * p1[c] + (t3 - 2 * t2 + t) * h * m1 + (-2 * t3 + 3 * t2) * p2[c] + (t3 - t2) * h * m2;
  }
  return out;
}
const S = Array.from({ length: NV }, (_, j) => j / (NV - 1) * LEG_LEN);
let C = S.map((s) => sampleTable(ctrl, s));
const grid = new Float64Array(NU * NV * 3);
let Fv = [];
function castLeg() {
  Fv = [];
  for (let j = 0; j < NV; j++) {
    const T = norm(sub(C[Math.min(j + 3, NV - 1)], C[Math.max(j - 3, 0)]));
    const X = norm(sub([1, 0, 0], [T[0] * T[0], T[1] * T[0], T[2] * T[0]]));
    const F = cross(T, X);
    Fv.push(F);
    for (let i = 0; i < NU; i++) {
      const th = i / NU * Math.PI * 2, d = add([X[0] * Math.cos(th), X[1] * Math.cos(th), X[2] * Math.cos(th)], F, Math.sin(th));
      let maxT = 0.16;
      if (d[0] < -1e-6) maxT = Math.min(maxT, (C[j][0] - 0.0015) / -d[0]); // 不越过身体中线
      let t = legCast(C[j], d, maxT);
      if (S[j] > 1.0) t = Math.min(t, 0.045);
      const p = add(C[j], d, t), k = (j * NU + i) * 3;
      grid[k] = p[0]; grid[k + 1] = p[1]; grid[k + 2] = p[2];
    }
  }
}
castLeg();
for (let iter = 0; iter < 2; iter++) { // 把脊线移到截面中心（两端渐变到不动，避免脊线出现折角）
  const wt = (s) => smooth(0.10, 0.17, s) * (1 - smooth(0.50, 0.70, s));
  const nc = C.map((c, j) => {
    const m = [0, 0, 0];
    for (let i = 0; i < NU; i++) for (let k = 0; k < 3; k++) m[k] += grid[(j * NU + i) * 3 + k] / NU;
    return lerp3(c, m, 0.8 * wt(S[j]));
  });
  for (let pass = 0; pass < 8; pass++) for (let j = 1; j < NV - 1; j++) {
    if (S[j] < 0.05 || S[j] > 0.79) continue;
    nc[j] = lerp3(nc[j], lerp3(nc[j - 1], nc[j + 1], 0.5), 0.5);
  }
  for (let pass = 0; pass < 40; pass++) for (let j = 1; j < NV - 1; j++) { // 小腿下段到脚背：重点保证切线连续
    if (S[j] < 0.5 || S[j] > 0.9) continue;
    nc[j] = lerp3(nc[j], lerp3(nc[j - 1], nc[j + 1], 0.5), 0.5);
  }
  C = nc; castLeg();
}
// 脚趾：射线会钻进趾缝，改用前脚掌三维凸包的截面（袜尖/鞋头本来就是绷在脚趾外面、横跨各趾的）。
// 仍然从脊线出发按同样的角度取点，所以和前面射线求交的部分能无缝衔接
const TOE_S0 = 0.925, toeJ0 = S.findIndex((s) => s >= TOE_S0);
const toeT0 = norm(sub(C[toeJ0 + 1], C[toeJ0 - 1]));
const footVerts = bodyP.filter((p) => p[0] > 0 && p[1] < gy + 0.09 && dot(sub(p, C[toeJ0]), toeT0) > -0.004)
  .filter((_, i, a) => i % Math.ceil(a.length / 1500) === 0);
console.log('forefoot hull points', footVerts.length);
function hull2(pts) { // Andrew 单调链，逆时针
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), h = [];
  for (const p of pts) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
  const lo = h.length + 1;
  for (let i = pts.length - 2; i >= 0; i--) { const p = pts[i]; while (h.length >= lo && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
  h.pop(); return h;
}
let lastRing = null;
for (let j = 0; j < NV; j++) {
  const w = smooth(TOE_S0, 0.985, S[j]); if (w === 0) continue;
  const T = norm(sub(C[Math.min(j + 1, NV - 1)], C[Math.max(j - 1, 0)]));
  const X = norm(sub([1, 0, 0], [T[0] * T[0], T[1] * T[0], T[2] * T[0]])), F = cross(T, X);
  // 凸包在该截面上的轮廓 = 截面两侧任意两点连线与截面交点的二维凸包
  const sec = [], back = [], front = [];
  for (const v of footVerts) {
    const dv = sub(v, C[j]), t = dot(dv, T), q = [dot(dv, X), dot(dv, F), t];
    if (Math.abs(t) < 0.0015) sec.push(q); else (t < 0 ? back : front).push(q);
  }
  for (const p of back) for (const q of front) { const u = p[2] / (p[2] - q[2]); sec.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]); }
  const h = sec.length >= 12 ? hull2(sec) : [];
  const inside = h.length >= 3 && h.every((p, i) => { const q = h[(i + 1) % h.length]; return p[0] * q[1] - p[1] * q[0] > 1e-9; });
  let ringPts;
  if (inside) {
    ringPts = [];
    for (let i = 0; i < NU; i++) {
      const th = i / NU * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      let t = 0;
      for (let e = 0; e < h.length; e++) { // 从脊线出发的射线与凸包边求交
        const p = h[e], q = h[(e + 1) % h.length], ex = q[0] - p[0], ey = q[1] - p[1], den = c * ey - sn * ex;
        if (den < 1e-12) continue;
        const tt = (p[0] * ey - p[1] * ex) / den, u = Math.abs(ex) > Math.abs(ey) ? (tt * c - p[0]) / ex : (tt * sn - p[1]) / ey;
        if (u >= -1e-6 && u <= 1 + 1e-6) t = Math.max(t, tt);
      }
      ringPts.push(add(add(C[j], X, t * c), F, t * sn));
    }
    lastRing = { j, ringPts };
  } else if (lastRing) {
    const k = Math.max(0.1, 1 - (j - lastRing.j) * 0.3);
    const m = [0, 0, 0]; for (const p of lastRing.ringPts) for (let q = 0; q < 3; q++) m[q] += p[q] / NU;
    ringPts = lastRing.ringPts.map((p) => add(lerp3(m, p, k), sub(C[j], C[lastRing.j])));
  } else continue;
  for (let i = 0; i < NU; i++) for (let q = 0; q < 3; q++) { const k = (j * NU + i) * 3 + q; grid[k] = grid[k] * (1 - w) + ringPts[i][q] * w; }
}
// 脚趾区域平滑（脚趾缝）
for (let pass = 0; pass < 6; pass++) {
  const cp = grid.slice();
  for (let j = 1; j < NV - 1; j++) {
    const w = smooth(0.90, 0.96, S[j]) * 0.7 + 0.08;
    for (let i = 0; i < NU; i++) for (let k = 0; k < 3; k++) {
      const a = (j * NU + i) * 3 + k, l = (j * NU + (i + 1) % NU) * 3 + k, r = (j * NU + (i + NU - 1) % NU) * 3 + k;
      grid[a] = cp[a] * (1 - w) + w * (cp[l] + cp[r] + cp[a - NU * 3] + cp[a + NU * 3]) / 4;
    }
  }
}
// 末端收口：最后几行向各自截面的中心收成圆顶，末行几乎并成一点（不留孔）
for (let r = 0; r < 6; r++) {
  const j = NV - 1 - r, u = 1 - r / 6, sc = Math.max(0.02, Math.sqrt(1 - u * u)), m = [0, 0, 0];
  for (let i = 0; i < NU; i++) for (let k = 0; k < 3; k++) m[k] += grid[(j * NU + i) * 3 + k] / NU;
  for (let i = 0; i < NU; i++) for (let k = 0; k < 3; k++) {
    const a = (j * NU + i) * 3 + k;
    grid[a] = m[k] + (grid[a] - m[k]) * sc;
  }
}

// ---------------------------------------------------------------- 站姿：把分开的腿收拢，再把脚掌转回水平
const phi = Math.atan2(ankle[0] - hip[0], hip[1] - ankle[1]);          // 原始外展角
const phiT = Math.atan2(ANKLE_X - hip[0], hip[1] - ankle[1]);          // 目标（略内收）
const rot = phi - phiT;                                                 // 绕 z 轴（髋关节）
console.log('abduction', (phi * 57.3).toFixed(1), '-> rotate', (rot * 57.3).toFixed(1));
const rotZ = (p, piv, ang) => { const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - piv[0], y = p[1] - piv[1]; return [piv[0] + x * c + y * s, piv[1] - x * s + y * c, p[2]]; };
const stance = (p, s, anklePiv) => {
  let q = rotZ(p, [hip[0], 0, 0], rot * smooth(0.0, 0.15, s));
  q = rotZ(q, anklePiv, -rot * smooth(0.765, 0.835, s));
  return [q[0] - hip[0], q[1], q[2]];                                   // 腿局部坐标：髋关节为原点
};
const anklePiv = rotZ(ankle, [hip[0], 0, 0], rot);
const rest = new Float64Array(NU * NV * 3), spine = new Float64Array(NV * 6);
for (let j = 0; j < NV; j++) {
  for (let i = 0; i < NU; i++) {
    const k = (j * NU + i) * 3, q = stance([grid[k], grid[k + 1], grid[k + 2]], S[j], anklePiv);
    rest[k] = q[0]; rest[k + 1] = q[1]; rest[k + 2] = q[2];
  }
  const c = stance(C[j], S[j], anklePiv);
  spine.set([...c, ...Fv[j]], j * 6);
}
const jl = (p, s) => stance(p, s, anklePiv);
const kneeL = jl(knee, KNEE_S), ankleL = jl(ankle, ANKLE_S);
const ballJ = S.findIndex((s) => s >= 0.985), ballL = [spine[ballJ * 6], spine[ballJ * 6 + 1], spine[ballJ * 6 + 2]];
let minY = 1e9; for (let k = 1; k < rest.length; k += 3) minY = Math.min(minY, rest[k]);
console.log('kneeL', kneeL, 'ankleL', ankleL, 'ballL', ballL, 'minY', minY.toFixed(4));

// ---------------------------------------------------------------- 骨盆 / 躯干
const torsoCast = makeCaster(tris.filter((t) => t.some((p) => p[1] > -0.2 && p[1] < 0.6) && t.every((p) => Math.abs(p[0]) < 0.3)));
let crotchY = 1e9;
for (const t of tris) for (const p of t) if (Math.abs(p[0]) < 0.004 && p[1] > -0.2 && p[1] < 0.1 && Math.abs(p[2]) < 0.05) crotchY = Math.min(crotchY, p[1]);
const PNU = 64;
function ring(y) {
  // 先求前后中点，再从中点向四周发射
  const f = torsoCast([0, y, 0], [0, 0, 1], 0.4), b = torsoCast([0, y, 0], [0, 0, -1], 0.4);
  const zc = (f - b) / 2, pts = [];
  for (let i = 0; i < PNU; i++) {
    const th = i / PNU * Math.PI * 2, d = [Math.cos(th), 0, Math.sin(th)];
    pts.push(add([0, y, zc], d, torsoCast([0, y, zc], d, 0.4)));
  }
  return pts;
}
const ringInfo = (pts) => {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
  return { a: Math.max(...xs), b: (Math.max(...zs) - Math.min(...zs)) / 2, zc: (Math.max(...zs) + Math.min(...zs)) / 2 };
};
// 腰：胯以上最细的一圈
let waistY = 0, wBest = 1e9;
for (let y = crotchY + 0.14; y < crotchY + 0.36; y += 0.005) { const a = ringInfo(ring(y)).a; if (a < wBest) { wBest = a; waistY = y; } }
const waist = { y: waistY, ...ringInfo(ring(waistY)) };
const wr = ring(waistY - 0.006), wzc = wr.reduce((m, p) => m + p[2], 0) / PNU;
// 以 (0, wzc) 为中心、按极角均匀重采样的腰围半径
const waistRing = [];
for (let i = 0; i < PNU; i++) { const th = i / PNU * Math.PI * 2, d = [Math.cos(th), 0, Math.sin(th)]; waistRing.push(torsoCast([0, waistY - 0.006, wzc], d, 0.4)); }
let hipsA = 0, hipsB = 0, hipsZc = 0;
for (let y = crotchY + 0.02; y < waistY; y += 0.01) { const r = ringInfo(ring(y)); if (r.a > hipsA) { hipsA = r.a; hipsZc = r.zc; } hipsB = Math.max(hipsB, r.b); }
console.log('crotchY', crotchY.toFixed(3), 'waist', waist, 'hips', hipsA.toFixed(3), hipsB.toFixed(3), hipsZc.toFixed(3));

const yBase = crotchY + 0.02, torsoTop = waistY + 0.115;
const pelvisRows = [], torsoRows = [];
for (let y = waistY - 0.022; y > yBase; y -= (waistY - 0.022 - yBase) / 28) pelvisRows.push(ring(y));
const base = ring(yBase); pelvisRows.push(base);
{ // 底部：从胯部中心向下的半球，限制半径以免伸进大腿表面
  const zc = ringInfo(base).zc, o = [0, yBase, zc];
  for (let e = 1; e <= 12; e++) {
    const el = e / 12 * Math.PI / 2, cap = 0.19 + (0.085 - 0.19) * smooth(0, 0.5, e / 12), row = [];
    for (let i = 0; i < PNU; i++) {
      const th = i / PNU * Math.PI * 2, d = [Math.cos(th) * Math.cos(el), -Math.sin(el), Math.sin(th) * Math.cos(el)];
      row.push(add(o, d, Math.min(torsoCast(o, d, 0.4), cap)));
    }
    pelvisRows.push(row);
  }
}
for (let y = torsoTop; y > waistY - 0.031; y -= (torsoTop - waistY + 0.032) / 24) torsoRows.push(ring(y));
torsoRows.push(ring(waistY - 0.032));

// ---------------------------------------------------------------- 输出
const b64 = (arr) => Buffer.from(Float32Array.from(arr).buffer).toString('base64'); // Float32：量化会在法线里留下噪声（袜尖的小圈尤其明显）
const r5 = (x) => +x.toFixed(5);
const out = {
  NU, NV, legLen: LEG_LEN, kneeS: KNEE_S, ankleS: ANKLE_S,
  hipX: r5(hip[0]), knee: kneeL.map(r5), ankle: ankleL.map(r5), ball: ballL.map(r5), ballS: r5(S[ballJ]),
  restMinY: r5(minY), crotchY: r5(crotchY),
  waist: { y: r5(waist.y), a: r5(waist.a), b: r5(waist.b), zc: r5(wzc), ring: waistRing.map(r5) },
  hips: { a: r5(hipsA), b: r5(hipsB), zc: r5(hipsZc) },
  pelvis: { nu: PNU, nv: pelvisRows.length, pos: b64(pelvisRows.flat(2)) },
  torso: { nu: PNU, nv: torsoRows.length, pos: b64(torsoRows.flat(2)) },
  rest: b64(rest), spine: b64(spine),
};
fs.writeFileSync(path.join(ROOT, 'src/bodydata.js'),
  '// 由 tools/fit-body.mjs 从 MakeHuman 基础网格（CC0，细分后）生成，请勿手改\nexport const BODY = ' + JSON.stringify(out) + ';\n');
console.log('wrote src/bodydata.js', (fs.statSync(path.join(ROOT, 'src/bodydata.js')).size / 1024).toFixed(0) + 'KB');
