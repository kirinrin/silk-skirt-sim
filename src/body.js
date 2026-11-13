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

// ---------------------------------------------------------------- 腿的形状
export const NU = 64, NV = 200;
export const HIP_X = 0.088, KNEE_S = 0.42, ANKLE_S = 0.82, LEG_LEN = 1.079;
const LEAN = 0.036; // 双腿略向内收

// [s, rx(横向), rf(前/脚背), rb(后/脚底), phi(脊线前倾角°)]
const LEG_ST = [
  [0.00, .086, .088, .100, 0],
  [0.08, .086, .088, .098, 0],
  [0.20, .0755, .079, .084, 0],
  [0.33, .0595, .062, .062, 0],
  [0.42, .0535, .0585, .053, 0],
  [0.47, .0490, .0510, .052, 0],
  [0.56, .0520, .0490, .063, 0],
  [0.68, .0390, .0400, .046, 0],
  [0.78, .0285, .0315, .033, 0],
  [0.82, .0290, .0330, .036, 0],
  [0.86, .0310, .0340, .046, 28],
  [0.90, .0340, .0310, .041, 50],
  [0.95, .0370, .0250, .027, 55],
  [1.00, .0420, .0180, .018, 60],
  [1.035, .0400, .0140, .013, 84],
  [1.062, .0300, .0100, .010, 90],
  [1.075, .0130, .0050, .005, 90],
  [1.079, .0010, .0010, .001, 90],
];

const N = NU * NV;
export const REST = new Float32Array(N * 3);   // 静止姿态（髋关节为原点，腿向 -y）
export const S_ROW = new Float32Array(NV);     // 每行沿腿的弧长 s
export const R_ROW = new Float32Array(NV);     // 每行平均半径
export const SPINE = new Float32Array(NV * 3); // y, z, phi
export const LEG_INDEX = gridIndex(NU, NV, true);
export const SUV = new Float32Array(N * 3);    // (cosθ, sinθ, s)
export const REST_H = new Float32Array(N), REST_V = new Float32Array(N);
export const REST_D1 = new Float32Array(N), REST_D2 = new Float32Array(N);
export const REST_LU = new Float32Array(N), REST_LV = new Float32Array(N);

(function buildRest() {
  const o = [0, 0, 0, 0];
  let cy = 0, cz = 0, prevPhi = 0;
  const ds = LEG_LEN / (NV - 1);
  for (let j = 0; j < NV; j++) {
    const s = j * ds;
    sampleTable(LEG_ST, s, o);
    const rx = Math.max(o[0], .0008), rf = Math.max(o[1], .0008), rb = Math.max(o[2], .0008);
    const phi = Math.max(0, o[3]) * Math.PI / 180;
    if (j > 0) { const pm = (phi + prevPhi) / 2; cy -= Math.cos(pm) * ds; cz += Math.sin(pm) * ds; }
    prevPhi = phi;
    S_ROW[j] = s; R_ROW[j] = (rx * 2 + rf + rb) / 4;
    SPINE[j * 3] = cy; SPINE[j * 3 + 1] = cz; SPINE[j * 3 + 2] = phi;
    const fy = Math.sin(phi), fz = Math.cos(phi);
    for (let i = 0; i < NU; i++) {
      const th = i / NU * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const r = sn > 0 ? rf : rb;
      const k = (j * NU + i) * 3;
      REST[k] = rx * c; REST[k + 1] = cy + fy * r * sn; REST[k + 2] = cz + fz * r * sn;
      SUV[k] = c; SUV[k + 1] = sn; SUV[k + 2] = s;
    }
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
    this.side = side;             // +1: x>0   -1: x<0
    this.hip = 0;                 // 髋前屈（弧度）
    this.knee = 0;                // 屈膝（弧度）
    this.loc = new Float32Array(N * 3);
    this.pos = new Float32Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.minY = 0;
    this.kneeLocal = new THREE.Vector3();
    this.ankleLocal = new THREE.Vector3();
    this.hipLocal = new THREE.Vector3(side * HIP_X, 0, 0);
    this._t = [0, 0, 0];
  }

  // 静止点 -> 身体局部坐标（髋关节中心为原点）
  skin(x, y, z, s, out) {
    const th = this.knee * smooth(0.345, 0.50, s);
    let py = y + KNEE_S;
    const c = Math.cos(th), sn = Math.sin(th);
    const y1 = py * c - z * sn - KNEE_S, z1 = py * sn + z * c;
    const ca = Math.cos(this.hip), sa = Math.sin(this.hip);
    const y2 = y1 * ca + z1 * sa, z2 = -y1 * sa + z1 * ca;
    const b = -this.side * LEAN, cb = Math.cos(b), sb = Math.sin(b);
    out[0] = x * cb - y2 * sb + this.side * HIP_X;
    out[1] = x * sb + y2 * cb;
    out[2] = z2;
    return out;
  }

  updateLocal() {
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
    this.skin(0, -KNEE_S, 0, 0, t); this.kneeLocal.set(t[0], t[1], t[2]);
    this.skin(0, -ANKLE_S, 0, 1, t); this.ankleLocal.set(t[0], t[1], t[2]);
  }

  applyRoot(root) {
    const loc = this.loc, pos = this.pos;
    const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
    for (let k = 0; k < N * 3; k += 3) {
      const x = loc[k], z = loc[k + 2];
      pos[k] = x * c + z * s + root.x;
      pos[k + 1] = loc[k + 1] + root.y;
      pos[k + 2] = -x * s + z * c + root.z;
    }
    gridNormals(pos, this.nrm, NU, NV);
  }
}

// ---------------------------------------------------------------- 躯干放样
function loft(table, nu, nv, linear) {
  const pos = new Float32Array(nu * nv * 3);
  const o = [0, 0, 0, 0];
  const y0 = table[0][0], y1 = table[table.length - 1][0];
  const neg = table.map((r) => [-r[0], ...r.slice(1)]); // 自上而下，键需递增
  for (let j = 0; j < nv; j++) {
    const y = y0 + (y1 - y0) * j / (nv - 1);
    sampleTable(neg, -y, o, linear);
    for (let i = 0; i < nu; i++) {
      const th = i / nu * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const k = (j * nu + i) * 3;
      pos[k] = Math.max(o[0], .0005) * c; pos[k + 1] = y;
      pos[k + 2] = (o[3] || 0) + Math.max(sn > 0 ? o[1] : o[2], .0005) * sn;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(gridIndex(nu, nv, true), 1));
  g.computeVertexNormals();
  return g;
}

export const WAIST_Y = 0.178;
export const WAIST_A = 0.125, WAIST_B = 0.095;

export function buildTorso() {
  const pelvis = loft([
    [0.19, .118, .090, .084, 0],
    [0.12, .140, .094, .098, 0],
    [0.05, .163, .094, .114, 0],
    [-0.02, .168, .090, .116, 0],
    [-0.07, .120, .075, .095, 0],
    [-0.105, .060, .050, .060, 0],
    [-0.12, .004, .004, .004, 0],
  ], 48, 40, false);
  const top = loft([
    [0.42, .001, .001, .001, 0],
    [0.419, .130, .100, .090, 0],
    [0.30, .125, .098, .088, 0],
    [0.19, .1195, .0915, .0855, 0],
  ], 48, 24, true);
  const band = loft([
    [0.208, .1215, .0915, .0915, -.002],
    [0.207, .1290, .0990, .0990, -.002],
    [0.168, .1300, .1000, .1000, -.002],
    [0.167, .1240, .0940, .0940, -.002],
  ], 64, 40, true);
  return { pelvis, top, band };
}

// 裙子用的碰撞体（身体局部坐标）
export function buildColliders(legs) {
  const caps = [];
  for (const leg of legs) {
    caps.push({ a: leg.hipLocal, b: leg.kneeLocal, ra: .096, rb: .062 });
    caps.push({ a: leg.kneeLocal, b: leg.ankleLocal, ra: .060, rb: .038 });
  }
  return {
    ell: { c: new THREE.Vector3(0, .02, -.012), r: new THREE.Vector3(.181, .19, .126) },
    caps,
  };
}
