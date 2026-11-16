// 程序化生成的下半身：双腿（CPU 蒙皮）、骨盆、上衣下摆，以及给裙子用的碰撞体
import * as THREE from 'three';

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 非均匀 Catmull-Rom 采样。table: [[key, v0, v1, ...], ...]
export function sampleTable(table, s, out, linear = false) {
  const n = table.length;
  const cols = table[0].length - 1;
  if (s <= table[0][0]) { for (let c = 0; c < cols; c++) out[c] = table[0][c + 1]; return out; }
  if (s >= table[n - 1][0]) { for (let c = 0; c < cols; c++) out[c] = table[n - 1][c + 1]; return out; }
  let i = 0;
  while (table[i + 1][0] < s) i++;
  const p1 = table[i], p2 = table[i + 1];
  const p0 = table[Math.max(i - 1, 0)], p3 = table[Math.min(i + 2, n - 1)];
  const h = p2[0] - p1[0], t = (s - p1[0]) / h, t2 = t * t, t3 = t2 * t;
  for (let c = 1; c <= cols; c++) {
    if (linear) { out[c - 1] = p1[c] + (p2[c] - p1[c]) * t; continue; }
    const m1 = (p2[c] - p0[c]) / (p2[0] - p0[0]);
    const m2 = (p3[c] - p1[c]) / (p3[0] - p1[0]);
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * p1[c] + (t3 - 2 * t2 + t) * h * m1 +
      (-2 * t3 + 3 * t2) * p2[c] + (t3 - t2) * h * m2;
  }
  return out;
}

export function gridIndex(NU, NV, wrap = true) {
  const cols = wrap ? NU : NU - 1;
  const idx = new Uint32Array(cols * (NV - 1) * 6);
  let k = 0;
  for (let j = 0; j < NV - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % NU;
      const a = j * NU + i, b = j * NU + i1, c = (j + 1) * NU + i, d = (j + 1) * NU + i1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  return idx;
}

// 网格法线：n = dP/du × dP/dv
export function gridNormals(pos, nrm, NU, NV, seamDup = false) {
  for (let j = 0; j < NV; j++) {
    const jm = (j > 0 ? j - 1 : 0) * NU, jp = (j < NV - 1 ? j + 1 : NV - 1) * NU, jj = j * NU;
    for (let i = 0; i < NU; i++) {
      let im, ip;
      if (seamDup) { // 最后一列是第一列的复制
        im = i === 0 ? NU - 2 : i - 1;
        ip = i === NU - 1 ? 1 : i + 1;
      } else { im = i === 0 ? NU - 1 : i - 1; ip = i === NU - 1 ? 0 : i + 1; }
      const a = (jj + ip) * 3, b = (jj + im) * 3, c = (jp + i) * 3, d = (jm + i) * 3;
      const ax = pos[a] - pos[b], ay = pos[a + 1] - pos[b + 1], az = pos[a + 2] - pos[b + 2];
      const bx = pos[c] - pos[d], by = pos[c + 1] - pos[d + 1], bz = pos[c + 2] - pos[d + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.sqrt((nx) ** 2 + (ny) ** 2 + (nz) ** 2) || 1;
      const o = (jj + i) * 3;
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
    }
  }
}

// ---------------------------------------------------------------- 真实人体数据（MakeHuman 基础网格重采样）
import { BODY } from './bodydata.js';

function decode(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
export const NU = BODY.NU, NV = BODY.NV;
export const HIP_X = BODY.hipX, KNEE_S = BODY.kneeS, ANKLE_S = BODY.ankleS, LEG_LEN = BODY.legLen;
const KNEE = BODY.knee, ANKLE = BODY.ankle, BALL = BODY.ball, BALL_S = BODY.ballS;
export const FOOT_PITCH = 0.62; // 穿高跟鞋时脚踝跖屈角

const N = NU * NV;
export const REST = decode(BODY.rest);         // x>0 侧的腿，髋关节为原点；另一条腿运行时镜像
export const SPINE = decode(BODY.spine);       // 每行: 中心 xyz + 前向 F xyz
export const S_ROW = new Float32Array(NV);     // 每行的名义弧长 s（膝=0.42，踝=0.82）
export const R_ROW = new Float32Array(NV);     // 每行平均半径
export const RMAX_ROW = new Float32Array(NV);  // 每行最大半径
export const LEG_INDEX = gridIndex(NU, NV, true);
export const LEG_INDEX_FLIP = LEG_INDEX.slice();
for (let k = 0; k < LEG_INDEX_FLIP.length; k += 3) { const t = LEG_INDEX_FLIP[k + 1]; LEG_INDEX_FLIP[k + 1] = LEG_INDEX_FLIP[k + 2]; LEG_INDEX_FLIP[k + 2] = t; }
export const SUV = new Float32Array(N * 3);    // (cosθ, sinθ, s)  cos>0 为外侧，sin>0 为前/脚背
export const REST_H = new Float32Array(N), REST_V = new Float32Array(N);
export const REST_D1 = new Float32Array(N), REST_D2 = new Float32Array(N);
export const REST_LU = new Float32Array(N), REST_LV = new Float32Array(N);

(function buildRest() {
  for (let j = 0; j < NV; j++) {
    const s = j / (NV - 1) * LEG_LEN;
    S_ROW[j] = s;
    let r = 0;
    for (let i = 0; i < NU; i++) {
      const th = i / NU * Math.PI * 2, k = (j * NU + i) * 3;
      SUV[k] = Math.cos(th); SUV[k + 1] = Math.sin(th); SUV[k + 2] = s;
      const d = Math.sqrt((REST[k] - SPINE[j * 6]) ** 2 + (REST[k + 1] - SPINE[j * 6 + 1]) ** 2 + (REST[k + 2] - SPINE[j * 6 + 2]) ** 2);
      r += d; if (d > RMAX_ROW[j]) RMAX_ROW[j] = d;
    }
    R_ROW[j] = r / NU;
  }
  const dist = (a, b) => Math.sqrt((REST[a * 3] - REST[b * 3]) ** 2 + (REST[a * 3 + 1] - REST[b * 3 + 1]) ** 2 + (REST[a * 3 + 2] - REST[b * 3 + 2]) ** 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * NU + i, i1 = (i + 1) % NU, im = (i + NU - 1) % NU;
    const jp = Math.min(j + 1, NV - 1), jm = Math.max(j - 1, 0);
    REST_H[a] = dist(a, j * NU + i1);
    REST_V[a] = dist(a, jp * NU + i);
    REST_D1[a] = dist(a, jp * NU + i1);
    REST_D2[a] = dist(j * NU + i1, jp * NU + i);
    REST_LU[a] = Math.max(dist(j * NU + i1, j * NU + im), 1e-5);
    REST_LV[a] = Math.max(dist(jp * NU + i, jm * NU + i), 1e-5);
  }
})();

export const rowOfS = (s) => Math.round(s / LEG_LEN * (NV - 1));

export class Leg {
  constructor(side) {
    this.side = side;             // +1: x>0   -1: x<0（镜像）
    this.index = side > 0 ? LEG_INDEX : LEG_INDEX_FLIP;
    this.hip = 0;                 // 髋前屈（弧度）
    this.knee = 0;                // 屈膝
    this.foot = 0;                // 踝跖屈（踮脚 / 高跟鞋）
    this.loc = new Float32Array(N * 3);
    this.pos = new Float32Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.cenLoc = new Float32Array(NV * 3); // 每行截面中心（脊线），随蒙皮更新
    this.cen = new Float32Array(NV * 3);
    this.minY = 0;
    this.kneeLocal = new THREE.Vector3();
    this.ankleLocal = new THREE.Vector3();
    this.hipLocal = new THREE.Vector3(side * HIP_X, 0, 0);
    this.thighLocal = new THREE.Vector3();
    this._t = [0, 0, 0]; this._ca = 1; this._sa = 0;
  }

  // 静止点（腿局部坐标）-> 身体局部坐标。关节依次为：跖趾、踝、膝、髋，都绕 x 轴
  skin(x, y, z, s, out) {
    if (s !== this._s || this.foot !== this._f || this.knee !== this._k) { // 同一行的顶点共用三角函数
      this._s = s; this._f = this.foot; this._k = this.knee;
      const tt = -this.foot * 0.92 * smooth(BALL_S - 0.03, BALL_S + 0.03, s);
      const ta = this.foot * smooth(0.775, 0.885, s), tk = this.knee * smooth(0.345, 0.50, s);
      this._r = [Math.cos(tt), Math.sin(tt), Math.cos(ta), Math.sin(ta), Math.cos(tk), Math.sin(tk)];
    }
    const r = this._r;
    let py = y - BALL[1], pz = z - BALL[2];
    y = py * r[0] - pz * r[1] + BALL[1]; z = py * r[1] + pz * r[0] + BALL[2];
    py = y - ANKLE[1]; pz = z - ANKLE[2];
    y = py * r[2] - pz * r[3] + ANKLE[1]; z = py * r[3] + pz * r[2] + ANKLE[2];
    py = y - KNEE[1]; pz = z - KNEE[2];
    const y1 = py * r[4] - pz * r[5] + KNEE[1], z1 = py * r[5] + pz * r[4] + KNEE[2];
    const ca = this._ca, sa = this._sa;
    out[0] = this.side * (x + HIP_X);
    out[1] = y1 * ca + z1 * sa;
    out[2] = -y1 * sa + z1 * ca;
    return out;
  }

  updateLocal() {
    this._ca = Math.cos(this.hip); this._sa = Math.sin(this.hip);
    const loc = this.loc, t = this._t;
    let minY = 1e9;
    for (let j = 0; j < NV; j++) {
      const s = S_ROW[j];
      for (let i = 0; i < NU; i++) {
        const k = (j * NU + i) * 3;
        this.skin(REST[k], REST[k + 1], REST[k + 2], s, t);
        loc[k] = t[0]; loc[k + 1] = t[1]; loc[k + 2] = t[2];
        if (t[1] < minY) minY = t[1];
      }
    }
    this.minY = minY;
    for (let j = 0; j < NV; j++) { this.skin(SPINE[j * 6] , SPINE[j * 6 + 1], SPINE[j * 6 + 2], S_ROW[j], t); this.cenLoc.set(t, j * 3); }
    this.skin(KNEE[0], KNEE[1], KNEE[2], 0, t); this.kneeLocal.set(t[0], t[1], t[2]);
    const tj = rowOfS(0.07) * 6;
    this.skin(SPINE[tj], SPINE[tj + 1], SPINE[tj + 2], 0, t); this.thighLocal.set(t[0], t[1], t[2]);
    this.skin(ANKLE[0], ANKLE[1], ANKLE[2], 0.6, t); this.ankleLocal.set(t[0], t[1], t[2]);
  }

  applyRoot(root) {
    const loc = this.loc, pos = this.pos, nrm = this.nrm;
    const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
    for (let k = 0; k < N * 3; k += 3) {
      const x = loc[k], z = loc[k + 2];
      pos[k] = x * c + z * s + root.x;
      pos[k + 1] = loc[k + 1] + root.y;
      pos[k + 2] = -x * s + z * c + root.z;
    }
    gridNormals(pos, nrm, NU, NV);
    if (this.side < 0) for (let k = 0; k < N * 3; k++) nrm[k] = -nrm[k];
    const cl = this.cenLoc, cw = this.cen;
    for (let k = 0; k < NV * 3; k += 3) {
      cw[k] = cl[k] * c + cl[k + 2] * s + root.x; cw[k + 1] = cl[k + 1] + root.y; cw[k + 2] = -cl[k] * s + cl[k + 2] * c + root.z;
    }
  }
}

// ---------------------------------------------------------------- 躯干
export const WAIST_Y = BODY.waist.y - 0.006;
export const WAIST_A = BODY.waist.a + 0.008, WAIST_B = BODY.waist.b + 0.008;
export const WAIST_ZC = BODY.waist.zc, HIPS_ZC = BODY.hips.zc;
// 真实腰围在极角 th 处的半径（以 (0, WAIST_ZC) 为中心）
export function waistRadius(th) {
  const r = BODY.waist.ring, n = r.length, f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * n, i = Math.floor(f);
  return r[i % n] + (r[(i + 1) % n] - r[i % n]) * (f - i);
}

function gridGeo(pos, nu, nv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(gridIndex(nu, nv, true), 1));
  g.computeVertexNormals();
  return g;
}

export function buildTorso() {
  const pelvis = gridGeo(decode(BODY.pelvis.pos), BODY.pelvis.nu, BODY.pelvis.nv);
  // 上衣：躯干外扩几毫米，顶部封口
  const nu = BODY.torso.nu, src = decode(BODY.torso.pos), rows = BODY.torso.nv;
  const top = new Float32Array((rows + 1) * nu * 3);
  let cx = 0, cz = 0;
  for (let i = 0; i < nu; i++) { cx += src[i * 3] / nu; cz += src[i * 3 + 2] / nu; }
  for (let i = 0; i < nu; i++) { top[i * 3] = cx; top[i * 3 + 1] = src[1]; top[i * 3 + 2] = cz; }
  for (let j = 0; j < rows; j++) {
    let mx = 0, mz = 0;
    for (let i = 0; i < nu; i++) { mx += src[(j * nu + i) * 3] / nu; mz += src[(j * nu + i) * 3 + 2] / nu; }
    for (let i = 0; i < nu; i++) {
      const k = (j * nu + i) * 3, o = ((j + 1) * nu + i) * 3;
      const dx = src[k] - mx, dz = src[k + 2] - mz, l = Math.hypot(dx, dz) || 1;
      const off = src[k + 1] < WAIST_Y + 0.005 ? -0.005 : 0.004; // 腰带以下收进裙子里
      top[o] = src[k] + dx / l * off; top[o + 1] = src[k + 1]; top[o + 2] = src[k + 2] + dz / l * off;
    }
  }
  // 腰带
  const bn = 64, bp = new Float32Array(4 * bn * 3);
  const ring = [[WAIST_Y + 0.030, -0.004], [WAIST_Y + 0.029, 0.004], [WAIST_Y - 0.010, 0.005], [WAIST_Y - 0.011, -0.002]];
  for (let j = 0; j < 4; j++) for (let i = 0; i < bn; i++) {
    const th = i / bn * Math.PI * 2, k = (j * bn + i) * 3;
    const r = waistRadius(th) + 0.008 + ring[j][1];
    bp[k] = r * Math.cos(th); bp[k + 1] = ring[j][0]; bp[k + 2] = WAIST_ZC + r * Math.sin(th);
  }
  return { pelvis, top: gridGeo(top, nu, rows + 1), band: gridGeo(bp, bn, 4) };
}

// 裙子用的碰撞体（身体局部坐标）
export function buildColliders(legs) {
  const R = (s) => R_ROW[rowOfS(s)], RM = (s) => RMAX_ROW[rowOfS(s)];
  const caps = [];
  for (const leg of legs) {
    caps.push({ a: leg.thighLocal, b: leg.kneeLocal, ra: RM(0.12) + 0.008, rb: R(KNEE_S) + 0.008 });
    caps.push({ a: leg.kneeLocal, b: leg.ankleLocal, ra: R(0.52) + 0.008, rb: R(0.78) + 0.006 });
  }
  const h = BODY.hips, w = BODY.waist;
  return {
    ells: [
      { c: new THREE.Vector3(0, 0.03, h.zc), r: new THREE.Vector3(h.a + 0.012, 0.20, h.b + 0.012) },
      { c: new THREE.Vector3(0, w.y - 0.10, (w.zc + h.zc) / 2), r: new THREE.Vector3((w.a + h.a) / 2 + 0.008, 0.10, (w.b + h.b) / 2 + 0.014) },
      { c: new THREE.Vector3(0, w.y - 0.035, w.zc), r: new THREE.Vector3(w.a + 0.004, 0.07, w.b + 0.004) },
    ],
    caps,
  };
}
