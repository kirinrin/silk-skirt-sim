// 丝袜：薄纱材质（随视角/拉伸变化的透明度 + 针织纹理）与可捏起回弹的弹性薄膜模拟
import * as THREE from 'three';
import {
  NU, NV, LEG_INDEX, SUV, S_ROW, R_ROW, REST_H, REST_V, REST_D1, REST_D2, REST_LU, REST_LV,
  gridNormals,
} from './body.js';

const N = NU * NV;
const OFFSET = 0.0009;       // 贴肤时离皮肤的距离
const EPS_LIFT = 0.00030;    // 离开皮肤的阈值
const EPS_LAND = 0.00006;    // 重新贴回的阈值
const WINDOW = 75;           // 仅模拟抓取点上下若干行
const MAX_PULL = 0.24;       // 拉得太远会脱手弹回

export const STYLES = {
  '连裤袜': { top: -1, band: 0 },
  '大腿袜': { top: 0.165, band: 0.034 },
  '过膝袜': { top: 0.335, band: 0.022 },
  '中筒袜': { top: 0.50, band: 0.018 },
};

export function denierToDensity(d) { return 0.95 * Math.pow(d / 40, 1.15); }

export function createStockingMaterial() {
  const uniforms = {
    uDensity: { value: denierToDensity(20) },
    uGloss: { value: 0.35 },
    uTop: { value: -1 },
    uBand: { value: 0 },
    uWales: { value: 420 },
    uCourses: { value: 640 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0e0e12, roughness: 0.6, metalness: 0,
    sheen: 1, sheenRoughness: 0.42, sheenColor: 0x555560,
    transparent: true, side: THREE.DoubleSide, depthWrite: true,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aStretch; attribute vec3 aSUV;
        varying float vStretch; varying vec3 vSUV;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStretch = aStretch; vSUV = aSUV;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vStretch; varying vec3 vSUV;
        uniform float uDensity, uGloss, uTop, uBand, uWales, uCourses;
        float sKnit, sDens;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vSUV.z < uTop) discard;
        {
          float th = atan(vSUV.y, vSUV.x);
          float dth = length(fwidth(vSUV.xy));
          float dsv = fwidth(vSUV.z);
          float fade = (1. - smoothstep(.12, .42, dth * uWales / 6.2832))
                     * (1. - smoothstep(.12, .42, dsv * uCourses));
          sKnit = sin(th * uWales) * sin(vSUV.z * uCourses * 6.2832) * fade;
          float band = uBand > 0. ? 1. - smoothstep(uTop + uBand, uTop + uBand + .003, vSUV.z) : 0.;
          // 袜口的罗纹
          float rib = .5 + .5 * sin(th * 90.);
          sDens = uDensity / pow(max(vStretch, .25), 1.15);
          sDens *= 1. + .5 * sKnit;
          sDens = mix(sDens, sDens * 2.6 + 1.1 + rib * .5, band);
          diffuseColor.rgb *= 1. + .12 * sKnit - band * rib * .15;
        }`)
      .replace('#include <opaque_fragment>', `
        {
          float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
          // 纤维遮盖率：掠射角时光线穿过更多纱线 -> 边缘更深
          float gz = 1. - ndv;
          float a = 1. - exp(-sDens * (1. + 1.6 * gz * gz) / max(ndv, .10));
          float spec = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(.3333));
          a = clamp(a + spec * (.15 + uGloss * 1.5), 0., 1.);
          diffuseColor.a = a;
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

export class StockingLeg {
  constructor(leg, material) {
    this.leg = leg;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.home = new Float32Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.stretch = new Float32Array(N);
    this.lifted = new Uint8Array(N);
    this.fixed = new Uint8Array(N);
    this.active = false;
    this.grabIdx = -1;
    this.grabSet = [];
    this.target = new THREE.Vector3();
    this.tension = 0.7;
    this.j0 = 0; this.j1 = NV - 1;
    this.base = new Float32Array(NV);
    for (let j = 0; j < NV; j++) this.base[j] = Math.pow(Math.max(R_ROW[j], .02) / 0.030, 0.42);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aStretch', new THREE.BufferAttribute(this.stretch, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSUV', new THREE.BufferAttribute(SUV, 3));
    g.setIndex(new THREE.BufferAttribute(LEG_INDEX, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 5);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
  }

  grab(idx, target) {
    const j = Math.floor(idx / NU), i = idx % NU;
    if (j < 3 || j > NV - 4) return false;
    this.grabIdx = idx;
    this.grabSet = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      this.grabSet.push((j + dj) * NU + (i + di + NU) % NU);
    }
    this.j0 = Math.max(0, j - WINDOW); this.j1 = Math.min(NV - 1, j + WINDOW);
    if (!this.active) { this.prev.set(this.pos); this.lifted.fill(0); }
    this.active = true;
    this.target.copy(target);
    return true;
  }
  moveGrab(target) { this.target.copy(target); }
  release() { this.grabIdx = -1; this.grabSet = []; }

  update(dt) {
    const leg = this.leg, home = this.home, lp = leg.pos, ln = leg.nrm;
    for (let k = 0; k < N * 3; k++) home[k] = lp[k] + ln[k] * OFFSET;
    if (this.active) {
      this.simulate(dt);
      gridNormals(this.pos, this.nrm, NU, NV);
    } else {
      this.pos.set(home);
      this.nrm.set(ln);
    }
    this.computeStretch();
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.aStretch.needsUpdate = true;
  }

  computeStretch() {
    const p = this.pos, st = this.stretch, base = this.base, tmp = this.tmp || (this.tmp = new Float32Array(N));
    for (let j = 0; j < NV; j++) {
      const jm = (j > 0 ? j - 1 : 0) * NU, jp = (j < NV - 1 ? j + 1 : NV - 1) * NU, jj = j * NU;
      for (let i = 0; i < NU; i++) {
        const a = (jj + (i === NU - 1 ? 0 : i + 1)) * 3, c = (jj + (i === 0 ? NU - 1 : i - 1)) * 3;
        const d = (jp + i) * 3, e = (jm + i) * 3;
        const lu = Math.sqrt((p[a] - p[c]) ** 2 + (p[a + 1] - p[c + 1]) ** 2 + (p[a + 2] - p[c + 2]) ** 2);
        const lv = Math.sqrt((p[d] - p[e]) ** 2 + (p[d + 1] - p[e + 1]) ** 2 + (p[d + 2] - p[e + 2]) ** 2);
        const o = jj + i;
        tmp[o] = Math.min(2.6, (lu / REST_LU[o]) * (lv / REST_LV[o]));
      }
    }
    // 平滑一次，避免贴肤/离肤交界处出现锯齿
    const blur = this.active;
    for (let j = 0; j < NV; j++) {
      const jm = (j > 0 ? j - 1 : 0) * NU, jp = (j < NV - 1 ? j + 1 : NV - 1) * NU, jj = j * NU, b = base[j];
      for (let i = 0; i < NU; i++) {
        const o = jj + i;
        let v = tmp[o];
        if (blur) {
          const ip = i === NU - 1 ? 0 : i + 1, im = i === 0 ? NU - 1 : i - 1;
          v = (v * 2 + tmp[jj + ip] + tmp[jj + im] + tmp[jp + i] + tmp[jm + i] +
            0.5 * (tmp[jp + ip] + tmp[jp + im] + tmp[jm + ip] + tmp[jm + im])) / 8;
        }
        st[o] = b * v;
      }
    }
  }

  simulate(dt) {
    const pos = this.pos, prev = this.prev, home = this.home, hn = this.leg.nrm;
    const lifted = this.lifted, fixed = this.fixed;
    const j0 = this.j0, j1 = this.j1, tau = this.tension;
    const K = 0.9, SUBS = 2, ITERS = 9;
    fixed.fill(0);
    for (let i = 0; i < NU; i++) { fixed[j0 * NU + i] = 1; fixed[j1 * NU + i] = 1; }

    // 抓取：拉得过远则脱手
    let gOff = null;
    if (this.grabIdx >= 0) {
      const g3 = this.grabIdx * 3;
      const dx = this.target.x - home[g3], dy = this.target.y - home[g3 + 1], dz = this.target.z - home[g3 + 2];
      if (Math.sqrt((dx) ** 2 + (dy) ** 2 + (dz) ** 2) > MAX_PULL) { this.release(); this.onSnap && this.onSnap(); }
      else { gOff = [dx, dy, dz]; for (const g of this.grabSet) fixed[g] = 2; }
    }
    const applyGrab = () => {
      if (!gOff) return;
      for (const g of this.grabSet) {
        const k = g * 3;
        pos[k] = home[k] + gOff[0]; pos[k + 1] = home[k + 1] + gOff[1]; pos[k + 2] = home[k + 2] + gOff[2];
        prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
        lifted[g] = 1;
      }
    };
    // 只受拉、不抗压的弹性约束
    const solve = (a, b, rest) => {
      const fa = fixed[a], fb = fixed[b];
      if (fa && fb) return;
      const a3 = a * 3, b3 = b * 3;
      const dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) return;
      const w = fa || fb ? 1 : 0.5;
      let c;
      if (d > rest) c = K * (d - rest) / d * w;
      else if (d < rest * 0.5 && lifted[a] && lifted[b]) c = 0.3 * (d - rest * 0.5) / d * w; // 轻微抗压，防止悬空处折叠
      else return;
      if (!fa) { pos[a3] += dx * c; pos[a3 + 1] += dy * c; pos[a3 + 2] += dz * c; }
      if (!fb) { pos[b3] -= dx * c; pos[b3 + 1] -= dy * c; pos[b3 + 2] -= dz * c; }
    };

    for (let sub = 0; sub < SUBS; sub++) {
      for (let j = j0; j <= j1; j++) for (let i = 0; i < NU; i++) {
        const a = j * NU + i, k = a * 3;
        if (lifted[a] && !fixed[a]) {
          for (let c = 0; c < 3; c++) {
            const v = (pos[k + c] - prev[k + c]) * 0.965;
            prev[k + c] = pos[k + c]; pos[k + c] += v;
          }
        } else if (fixed[a] !== 2) {
          pos[k] = prev[k] = home[k]; pos[k + 1] = prev[k + 1] = home[k + 1]; pos[k + 2] = prev[k + 2] = home[k + 2];
        }
      }
      for (let it = 0; it < ITERS; it++) {
        applyGrab();
        const fwd = (it & 1) === 0;
        for (let jj = j0; jj < j1; jj++) {
          const j = fwd ? jj : j0 + j1 - 1 - jj;
          for (let ii = 0; ii < NU; ii++) {
            const i = fwd ? ii : NU - 1 - ii;
            const a = j * NU + i, b = j * NU + (i + 1) % NU, c = a + NU, d = b + NU;
            if (!(lifted[a] | lifted[b] | lifted[c] | lifted[d])) continue; // 全部贴肤的区域跳过
            solve(a, b, REST_H[a] * tau);
            solve(a, c, REST_V[a] * tau);
            solve(a, d, REST_D1[a] * tau);
            solve(b, c, REST_D2[a] * tau);
          }
        }
        // 与皮肤的接触：贴住则被摩擦“粘”在原位，被张力抬起则自由
        for (let j = j0; j <= j1; j++) for (let i = 0; i < NU; i++) {
          const a = j * NU + i;
          if (fixed[a] === 2) continue;
          const k = a * 3;
          const d = (pos[k] - home[k]) * hn[k] + (pos[k + 1] - home[k + 1]) * hn[k + 1] + (pos[k + 2] - home[k + 2]) * hn[k + 2];
          if (fixed[a] === 1 || d < (lifted[a] ? EPS_LAND : EPS_LIFT)) {
            pos[k] = home[k]; pos[k + 1] = home[k + 1]; pos[k + 2] = home[k + 2];
            if (lifted[a]) { prev[k] = home[k]; prev[k + 1] = home[k + 1]; prev[k + 2] = home[k + 2]; }
            lifted[a] = 0;
          } else lifted[a] = 1;
        }
      }
    }
    if (this.grabIdx < 0) {
      let any = 0;
      for (let a = j0 * NU; a < (j1 + 1) * NU; a++) any |= lifted[a];
      if (!any) this.active = false;
    }
  }
}
