// 百褶裙：PBD 布料模拟（粗网格）+ 刀褶几何重建（渲染网格）
// 模拟网格只表示裙子的“包络面”；褶子在周向被拉开时会展平，收拢时折叠。
import * as THREE from 'three';
import { gridIndex, gridNormals, smooth, WAIST_Y, WAIST_A, WAIST_B } from './body.js';
import { SETT } from './textures.js';

const SUB = 4;          // 每个褶对应的模拟列数
const K = 8;            // 每个褶的渲染采样数
const E = 0.07;
const GAP = 0.0016;     // 被遮住的布层向内错开，避免闪烁
const MAX_PULL = 0.5;

export class Skirt {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.grabIdx = -1; this.target = new THREE.Vector3();
    this.time = 0;
  }

  build({ pleats, length }, root) {
    const P = this.P = pleats, SU = this.SU = P * SUB, SV = this.SV = 28;
    this.length = length;
    const n = SU * SV;
    this.rest = new Float32Array(n * 3);   // 身体局部坐标
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.open = new Float32Array(n);
    this.invM = new Float32Array(n).fill(1);
    const A1 = WAIST_A + length * 0.40, B1 = WAIST_B + length * 0.39;
    for (let j = 0; j < SV; j++) {
      const t = j / (SV - 1);
      const a = WAIST_A + (A1 - WAIST_A) * t, b = WAIST_B + (B1 - WAIST_B) * t;
      for (let i = 0; i < SU; i++) {
        const th = i / SU * Math.PI * 2, k = (j * SU + i) * 3;
        this.rest[k] = a * Math.cos(th); this.rest[k + 1] = WAIST_Y - length * 0.92 * t; this.rest[k + 2] = -0.002 + b * Math.sin(th);
      }
    }
    for (let i = 0; i < SU; i++) this.invM[i] = 0;

    const R = this.rest;
    const dist = (a, b) => Math.sqrt((R[a * 3] - R[b * 3]) ** 2 + (R[a * 3 + 1] - R[b * 3 + 1]) ** 2 + (R[a * 3 + 2] - R[b * 3 + 2]) ** 2);
    // 每行的褶宽与最大展开宽度
    this.W = new Float32Array(SV); this.WMAX = new Float32Array(SV);
    for (let j = 0; j < SV; j++) {
      let c = 0; for (let i = 0; i < SU; i++) c += dist(j * SU + i, j * SU + (i + 1) % SU);
      this.W[j] = c / P; // 一个褶的可见宽度
    }
    this.FTOT = this.W[SV - 1] * 2.1; // 每个褶消耗的面料宽度（矩形面料，上下一致）
    for (let j = 0; j < SV; j++) {
      const t = j / (SV - 1);
      this.WMAX[j] = this.W[j] * (1 + (this.FTOT / this.W[j] - 1) * smooth(0.06, 0.5, t));
    }
    // 约束: [a, b, rest, max, k]
    const cs = [];
    for (let j = 0; j < SV; j++) for (let i = 0; i < SU; i++) {
      const a = j * SU + i, i1 = (i + 1) % SU, i2 = (i + 2) % SU;
      const ratio = this.WMAX[j] / this.W[j];
      if (j > 0) {
        const r = dist(a, j * SU + i1); cs.push(a, j * SU + i1, r, r * ratio, 0.07);
        const r2 = dist(a, j * SU + i2); cs.push(a, j * SU + i2, r2, r2 * ratio, 0.07);
      }
      if (j < SV - 1) {
        const r = dist(a, a + SU); cs.push(a, a + SU, r, r * 1.004, 0.4);
        const rr = this.WMAX[j + 1] / this.W[j + 1];
        const d1 = dist(a, (j + 1) * SU + i1); cs.push(a, (j + 1) * SU + i1, d1, d1 * (1 + (rr - 1) * 0.8), 0.03);
        const d2 = dist(j * SU + i1, a + SU); cs.push(j * SU + i1, a + SU, d2, d2 * (1 + (rr - 1) * 0.8), 0.03);
      }
      if (j < SV - 2) { const r = dist(a, a + 2 * SU); cs.push(a, a + 2 * SU, r, r * 1.004, 0.30); }
      if (j < SV - 5) { const r = dist(a, a + 5 * SU); cs.push(a, a + 5 * SU, r, r * 1.004, 0.22); }
    }
    this.nc = cs.length / 5;
    this.cA = new Int32Array(this.nc); this.cB = new Int32Array(this.nc);
    this.cR = new Float32Array(this.nc); this.cM = new Float32Array(this.nc); this.cK = new Float32Array(this.nc);
    for (let c = 0; c < this.nc; c++) {
      this.cA[c] = cs[c * 5]; this.cB[c] = cs[c * 5 + 1]; this.cR[c] = cs[c * 5 + 2]; this.cM[c] = cs[c * 5 + 3]; this.cK[c] = cs[c * 5 + 4];
    }

    // 渲染网格
    const RU = this.RU = P * K + 1;
    const rn = RU * SV;
    this.rpos = new Float32Array(rn * 3); this.rnrm = new Float32Array(rn * 3);
    this.simOf = new Int32Array(rn);
    const uv = new Float32Array(rn * 2);
    this.prof = new Float32Array(SV * K); // 每行的面料参数 f（以褶宽为单位）
    this.Dj = new Float32Array(SV);
    for (let j = 0; j < SV; j++) {
      const D = this.Dj[j] = (this.FTOT - this.W[j]) / (2 * this.W[j]);
      const f = [0, D, D + 0.5, D + 1 - E, D + 1, D + 1 + E, 1 + 1.5 * D, 1 + 2 * D - E];
      for (let k = 0; k < K; k++) this.prof[j * K + k] = f[k];
      for (let c = 0; c < RU; c++) {
        const p = Math.floor(c / K), k = c % K;
        const o = (j * RU + c) * 2;
        uv[o] = (p * this.FTOT + f[k] * this.W[j]) / SETT;
        uv[o + 1] = -(j / (SV - 1)) * length / SETT;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rpos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.rnrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(gridIndex(RU, SV, false), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 5);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.reset(root);
  }

  reset(root) {
    const c = Math.cos(root.yaw), s = Math.sin(root.yaw), R = this.rest;
    for (let k = 0; k < R.length; k += 3) {
      this.pos[k] = R[k] * c + R[k + 2] * s + root.x;
      this.pos[k + 1] = R[k + 1] + root.y;
      this.pos[k + 2] = -R[k] * s + R[k + 2] * c + root.z;
    }
    this.prev.set(this.pos);
    this.prevRoot = { ...root };
    this.grabIdx = -1;
  }

  grab(renderVertex, target) {
    this.grabIdx = this.simOf[renderVertex];
    if (this.grabIdx < this.SU * 2) { this.grabIdx = -1; return false; }
    this.target.copy(target);
    return true;
  }
  moveGrab(t) { this.target.copy(t); }
  release() { this.grabIdx = -1; }

  step(dt, root, col, prm) {
    const { SU, SV, pos, prev, nrm, invM, rest } = this;
    const n = SU * SV, SUBS = 3, ITERS = 5, h = dt / SUBS;
    this.time += dt;
    const tm = this.time;
    gridNormals(pos, nrm, SU, SV);
    const cAir = prm.air * 7 / prm.weight;
    const wx = Math.sin(prm.windDir) * prm.wind, wz = Math.cos(prm.windDir) * prm.wind, wy = prm.updraft;
    const g = -9.8 * (0.55 + 0.75 * prm.weight);
    const pr = this.prevRoot;

    if (this.grabIdx >= 0) {
      const k = this.grabIdx * 3;
      const j = Math.floor(this.grabIdx / SU);
      // 拉得超过布料可达范围太多则脱手
      const wy0 = rest[1] + root.y;
      const reach = j / (SV - 1) * this.length + MAX_PULL;
      if (Math.sqrt((this.target.x - root.x) ** 2 + (this.target.y - wy0) ** 2 + (this.target.z - root.z) ** 2) > reach + 0.25) this.release();
    }

    for (let sub = 0; sub < SUBS; sub++) {
      const al = (sub + 1) / SUBS;
      const rx = pr.x + (root.x - pr.x) * al, ry = pr.y + (root.y - pr.y) * al, rz = pr.z + (root.z - pr.z) * al;
      const yaw = pr.yaw + (root.yaw - pr.yaw) * al;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < SU; i++) { // 腰部固定
        const k = i * 3;
        pos[k] = rest[k] * cy + rest[k + 2] * sy + rx; pos[k + 1] = rest[k + 1] + ry; pos[k + 2] = -rest[k] * sy + rest[k + 2] * cy + rz;
        prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
      }
      for (let a = SU; a < n; a++) {
        const k = a * 3;
        const px = pos[k], py = pos[k + 1], pz = pos[k + 2];
        const vx = px - prev[k], vy = py - prev[k + 1], vz = pz - prev[k + 2];
        // 阵风
        const gust = 0.6 + 0.3 * Math.sin(tm * 1.9 + px * 3.1) + 0.25 * Math.sin(tm * 4.7 + py * 6.0 + pz * 2.3) + 0.15 * Math.sin(tm * 9.1 + px * 9 - pz * 7);
        const rwx = wx * gust - vx / h, rwy = wy * gust - vy / h, rwz = wz * gust - vz / h;
        const an = (nrm[k] * rwx + nrm[k + 1] * rwy + nrm[k + 2] * rwz) * cAir;
        const ci = cAir * 0.06, lift = wy * gust * cAir * 0.13 * (a / n); // 各向同性阻力 + 裙底上升气流
        prev[k] = px; prev[k + 1] = py; prev[k + 2] = pz;
        pos[k] = px + vx * 0.999 + (nrm[k] * (an + lift * 0.5) + rwx * ci) * h * h;
        pos[k + 1] = py + vy * 0.999 + (nrm[k + 1] * an + g + lift + rwy * ci) * h * h;
        pos[k + 2] = pz + vz * 0.999 + (nrm[k + 2] * (an + lift * 0.5) + rwz * ci) * h * h;
      }
      const gi = this.grabIdx;
      for (let it = 0; it < ITERS; it++) {
        if (gi >= 0) { pos[gi * 3] = this.target.x; pos[gi * 3 + 1] = this.target.y; pos[gi * 3 + 2] = this.target.z; }
        const { cA, cB, cR, cM, cK, nc } = this;
        for (let c = 0; c < nc; c++) {
          const a = cA[c], b = cB[c];
          let wa = invM[a], wb = invM[b];
          if (a === gi) wa = 0; if (b === gi) wb = 0;
          const ws = wa + wb; if (ws === 0) continue;
          const a3 = a * 3, b3 = b * 3;
          const dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const m = cM[c];
          const corr = d > m ? (d - m) + cK[c] * (m - cR[c]) : cK[c] * (d - cR[c]);
          const f = corr / d / ws;
          pos[a3] += dx * f * wa; pos[a3 + 1] += dy * f * wa; pos[a3 + 2] += dz * f * wa;
          pos[b3] -= dx * f * wb; pos[b3 + 1] -= dy * f * wb; pos[b3 + 2] -= dz * f * wb;
        }
      }
      if (gi >= 0) { pos[gi * 3] = this.target.x; pos[gi * 3 + 1] = this.target.y; pos[gi * 3 + 2] = this.target.z; }
      this.collide(rx, ry, rz, cy, sy, col);
    }
    this.prevRoot = { ...root };
  }

  collide(rx, ry, rz, cy, sy, col) {
    const { SU, SV, pos, prev } = this, n = SU * SV;
    const e = col.ell, caps = col.caps, groundY = 0.004;
    for (let a = SU; a < n; a++) {
      const k = a * 3;
      const wx = pos[k] - rx, wz = pos[k + 2] - rz;
      let x = wx * cy - wz * sy, y = pos[k + 1] - ry, z = wx * sy + wz * cy;
      let hit = false;
      // 骨盆椭球
      const qx = (x - e.c.x) / e.r.x, qy = (y - e.c.y) / e.r.y, qz = (z - e.c.z) / e.r.z;
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (l < 1 && l > 1e-6) {
        x = e.c.x + qx / l * e.r.x; y = e.c.y + qy / l * e.r.y; z = e.c.z + qz / l * e.r.z; hit = true;
      }
      // 大腿 / 小腿胶囊
      for (let c = 0; c < caps.length; c++) {
        const cp = caps[c], A = cp.a, B = cp.b;
        const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
        let t = ((x - A.x) * abx + (y - A.y) * aby + (z - A.z) * abz) / (abx * abx + aby * aby + abz * abz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = A.x + abx * t, cyy = A.y + aby * t, cz = A.z + abz * t;
        const r = cp.ra + (cp.rb - cp.ra) * t;
        const dx = x - cx, dy = y - cyy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r && d2 > 1e-10) {
          const d = Math.sqrt(d2), s = r / d;
          x = cx + dx * s; y = cyy + dy * s; z = cz + dz * s; hit = true;
        }
      }
      if (hit) {
        const nx = x * cy + z * sy + rx, ny = y + ry, nz = -x * sy + z * cy + rz;
        pos[k] = nx; pos[k + 1] = ny; pos[k + 2] = nz;
        // 摩擦
        prev[k] += (nx - prev[k]) * 0.35; prev[k + 1] += (ny - prev[k + 1]) * 0.35; prev[k + 2] += (nz - prev[k + 2]) * 0.35;
      }
      if (pos[k + 1] < groundY) { pos[k + 1] = groundY; prev[k] = pos[k]; prev[k + 2] = pos[k + 2]; }
    }
  }

  updateMesh() {
    const { P, SU, SV, RU, pos, nrm, open, rpos, W, WMAX, prof, Dj, simOf } = this;
    gridNormals(pos, nrm, SU, SV);
    for (let j = 0; j < SV; j++) {
      const span = WMAX[j] - W[j];
      for (let i = 0; i < SU; i++) {
        const a = (j * SU + (i + 1) % SU) * 3, b = (j * SU + (i + SU - 1) % SU) * 3;
        const d = Math.sqrt((pos[a] - pos[b]) ** 2 + (pos[a + 1] - pos[b + 1]) ** 2 + (pos[a + 2] - pos[b + 2]) ** 2) * 0.5 * SUB;
        open[j * SU + i] = Math.min(1, Math.max(0, (d - W[j] * 1.02) / Math.max(span, 0.45 * W[j])));
      }
    }
    for (let j = 0; j < SV; j++) {
      const t = j / (SV - 1), D = Dj[j], hgt = 0.0015 + 0.0085 * t, row = j * SU;
      for (let c = 0; c < RU; c++) {
        const p = Math.floor(c / K), k = c % K, f = prof[j * K + k];
        const ic = (p % P) * SUB;
        const o = (open[row + (ic + 1) % SU] + open[row + (ic + 2) % SU] + open[row + (ic + 3) % SU]) / 3;
        // 几何上的暗褶深度做上限（面料坐标 f 仍按真实用料计算，保证花纹连续）
        const Dg = Math.min(D, 0.62), sc = Dg / D;
        let xf, nf, hid;
        if (f <= 1 + D) { xf = f < D ? (f - D) * sc : f - D; nf = f < D ? 0 : (f - D); hid = f < D - 1e-6 ? 1 : 0; }
        else { const q = (f - 1 - D) * sc; xf = 1 - q; nf = Math.max(0, 1 - q / 0.25); hid = Math.min(1, q / 0.25); }
        const x = xf + ((f - D) / (1 + 2 * D) - xf) * o;
        const off = (nf * hgt - hid * GAP) * (1 - o) + 0.0008;
        let cc = (p + x) * SUB; cc = ((cc % SU) + SU) % SU;
        const i0 = Math.floor(cc), fr = cc - i0, i1 = (i0 + 1) % SU;
        const a = (row + i0) * 3, b = (row + i1) * 3, r = (j * RU + c) * 3;
        let nx = nrm[a] + (nrm[b] - nrm[a]) * fr, ny = nrm[a + 1] + (nrm[b + 1] - nrm[a + 1]) * fr, nz = nrm[a + 2] + (nrm[b + 2] - nrm[a + 2]) * fr;
        const l = Math.sqrt((nx) ** 2 + (ny) ** 2 + (nz) ** 2) || 1;
        rpos[r] = pos[a] + (pos[b] - pos[a]) * fr + nx / l * off;
        rpos[r + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * fr + ny / l * off;
        rpos[r + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * fr + nz / l * off;
        simOf[j * RU + c] = row + (fr < 0.5 ? i0 : i1);
      }
    }
    gridNormals(rpos, this.rnrm, RU, SV, true);
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }
}
