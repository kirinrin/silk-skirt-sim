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
const SLIDE_FREE = 0.004;    // 离皮肤超过这个距离后才能自由横向滑动
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
    uShine: { value: 0.5 },      // 丝光（纤维方向的各向异性高光）
    uTop: { value: -1 },
    uBand: { value: 0 },
    uWales: { value: 420 },
    uCourses: { value: 640 },
    uSeam: { value: 0 },         // 背缝线
    uReinf: { value: 1 },        // 加固袜尖 / 脚跟
    uFiber: { value: new THREE.Color(0xffffff) },
    uSkin: { value: new THREE.Color(0xeec0a8) },   // 皮肤底色（分层着色用）
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
        attribute vec3 aStretch; attribute vec3 aSUV;
        varying vec3 vStretch; varying vec3 vSUV;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStretch = aStretch; vSUV = aSUV;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vStretch; varying vec3 vSUV;
        uniform float uDensity, uGloss, uShine, uTop, uBand, uWales, uCourses, uSeam, uReinf;
        uniform vec3 uFiber, uSkin;
        float sDens, sFade, sTh, sWrk, sWrkPh, sCourse;
        vec3 sTth, sTs;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vSUV.z < uTop) discard;
        {
          vec2 cs = normalize(vSUV.xy);
          sTh = atan(cs.y, cs.x);
          // 织物坐标系：sTth 绕腿一周（线圈横列方向），sTs 沿腿长
          vec3 pV = -vViewPosition, dpx = dFdx(pV), dpy = dFdy(pV);
          float dthx = cs.x * dFdx(vSUV.y) - cs.y * dFdx(vSUV.x), dthy = cs.x * dFdy(vSUV.y) - cs.y * dFdy(vSUV.x);
          float dsx = dFdx(vSUV.z), dsy = dFdy(vSUV.z);
          vec3 tA = dpx * dsy - dpy * dsx, tB = dpy * dthx - dpx * dthy;
          sTth = length(tA) > 1e-12 ? normalize(tA) : vec3(1., 0., 0.);
          sTs = length(tB) > 1e-12 ? normalize(tB) : vec3(0., 1., 0.);

          float dth = length(vec2(dthx, dthy)), dsv = length(vec2(dsx, dsy));
          sFade = (1. - smoothstep(.12, .42, dth * uWales / 6.2832)) * (1. - smoothstep(.12, .42, dsv * uCourses));
          sCourse = vSUV.z * uCourses * 6.2832;
          // 纬编线圈：相邻横列错开半个线圈
          float row = sin(sCourse);
          float loops = sin(sTh * uWales + 1.5708 * sign(row)) * abs(row);
          float knit = loops * sFade;
          // 中距离仍可见的粗一级网纹（真实丝袜的线圈在远处会“聚集”成更粗的纹理）
          float fade2 = (1. - smoothstep(.12, .42, dth * uWales / 18.85)) * (1. - smoothstep(.12, .42, dsv * uCourses / 3.)) * (1. - sFade * .8);
          knit += sin(sTh * uWales / 3. + sin(sCourse / 3.)) * sin(sCourse / 3.) * fade2 * .16;
          // 横向条影（纱线粗细不匀），远看也保留一点
          float bar = sin(vSUV.z * 913. + 2. * sin(sTh * 2.)) * sin(vSUV.z * 377. + 1.3) * (1. - smoothstep(.2, .6, dsv * 300.));

          // 关节处被压缩 -> 细褶
          sWrk = smoothstep(.93, .70, vStretch.y);
          sWrkPh = vSUV.z * 6.2832 * 170. + 3.5 * sin(sTh * 3. + vSUV.z * 23.) + 2.4 * sin(sTh * 7. + vSUV.z * 61.) + 1.2 * sin(sTh * 13. - vSUV.z * 90.);
          float wr = .5 + .5 * sin(sWrkPh);

          sDens = uDensity / pow(max(vStretch.x, .25), 1.15);
          sDens *= 1. + .55 * knit + .022 * bar;
          sDens *= 1. + sWrk * (wr * .7 - .1);

          // 袜口
          float band = uBand > 0. ? 1. - smoothstep(uTop + uBand, uTop + uBand + .003, vSUV.z) : 0.;
          float rib = .5 + .5 * sin(sTh * 90.);
          sDens = mix(sDens, sDens * 2.6 + 1.1 + rib * .5, band);
          // 加固袜尖 / 脚跟
          float toe = smoothstep(.992, 1.0, vSUV.z);
          float heel = smoothstep(.800, .812, vSUV.z) * (1. - smoothstep(.888, .90, vSUV.z)) * smoothstep(.05, -.25, cs.y);
          float toeLine = smoothstep(.9885, .992, vSUV.z) * (1. - smoothstep(.992, .9955, vSUV.z));
          sDens += uReinf * ((toe + heel) * (1.6 + sDens * 1.5) + toeLine * 2.5);
          // 背缝线
          float seam = (1. - smoothstep(.010, .022, abs(cs.x))) * step(cs.y, 0.) * (1. - smoothstep(.84, .86, vSUV.z));
          sDens += uSeam * seam * 6.;

          diffuseColor.rgb *= 1. + .12 * knit - band * rib * .15 - sWrk * wr * .15;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // 线圈与细褶的微观法线
          float row = sin(sCourse);
          float gA = cos(sTh * uWales + 1.5708 * sign(row)) * abs(row);
          float gB = cos(sCourse) * sin(sTh * uWales);
          vec3 bump = (sTth * gA + sTs * gB) * (.22 * sFade) + sTs * (cos(sWrkPh) * sWrk * .32);
          normal = normalize(normal - (bump - normal * dot(bump, normal)));
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // 纤维高光（Kajiya-Kay）：横列方向的纱线 -> 沿腿长的丝光条；另有一条较弱的交叉高光
          vec3 Vv = normalize(vViewPosition);
          vec3 Tt = normalize(sTth - normal * dot(sTth, normal));
          vec3 Tl = normalize(sTs - normal * dot(sTs, normal));
          float e1 = mix(12., 56., uGloss), e2 = mix(6., 24., uGloss);
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 L = directionalLights[i].direction;
            vec3 Hh = normalize(L + Vv);
            float nl = saturate(dot(normal, L) * .75 + .25) * saturate(dot(normal, L) * 4. + 1.);
            float a1 = dot(Tt, Hh), a2 = dot(Tl, Hh);
            float lobe = pow(max(1. - a1 * a1, 0.), e1) * 1.0 + pow(max(1. - a2 * a2, 0.), e2) * .28;
            vec3 lc = directionalLights[i].color;
            #if NUM_DIR_LIGHT_SHADOWS > 0
            if (i == 0) lc *= mix(.12, 1., getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]));
            #endif
            reflectedLight.directSpecular += lc * uFiber * (lobe * nl * uShine * (.04 + .22 * uGloss));
          }
        }
        #endif`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
        float keyShadow() {
          #if NUM_DIR_LIGHT_SHADOWS > 0
          return getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #else
          return 1.;
          #endif
        }`)
      .replace('#include <opaque_fragment>', `
        {
          // ---- 分层模型：纱线层盖在皮肤层上，而不是简单的半透明混合 ----
          float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
          float gz = 1. - ndv;
          // 沿视线方向的纱线遮盖率：掠射角时穿过更多纱线 -> 边缘更实
          float aV = 1. - exp(-sDens * (1. + 1.6 * gz * gz) / max(ndv, .10));
          float spec = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular * .5, vec3(.3333));
          aV = clamp(aV + spec * (.15 + uGloss * .9), 0., 1.);
          // 贴肤程度：被捏起离开皮肤后，层间的相互作用消失
          float contact = exp(-max(vStretch.z, 0.) / .004);
          // 皮肤表面的入射光（主光带阴影）
          vec3 E = vec3(.30) * (.6 + .4 * normal.y);
          float aL = 0.;
          #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            float nl = saturate(dot(normal, directionalLights[i].direction));
            vec3 lc = directionalLights[i].color * nl; if (i == 0) lc *= keyShadow();
            E += lc;
          }
          // 沿主光方向的遮盖率：纱线在皮肤上投下的细密阴影
          aL = 1. - exp(-sDens / max(saturate(dot(normal, directionalLights[0].direction)), .18));
          #endif
          vec3 skinLit = uSkin * E * RECIPROCAL_PI;
          vec3 dye = diffuseColor.rgb;
          // 1) 皮肤被纱线挡光而变暗：多扣掉一部分透过量
          float shade = aL * .62 * contact;
          float A = 1. - (1. - aV) * (1. - shade);
          // 2) 皮肤的反光从背后照亮纱线（深色纱线几乎不受影响，浅色/肉色纱线会透出暖色）
          vec3 back = dye * skinLit * (.75 * contact) * aV;
          // 3) 光在纱线与皮肤之间来回散射：让浅色丝袜更匀净、带一点柔光
          vec3 inter = dye * skinLit * ((1. - aV) * aL * .5 * contact);
          vec3 C = outgoingLight * aV + back + inter;
          outgoingLight = C / max(A, 1e-3);
          diffuseColor.a = A;
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
    this.stretch = new Float32Array(N * 3);
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
    g.setAttribute('aStretch', new THREE.BufferAttribute(this.stretch, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSUV', new THREE.BufferAttribute(SUV, 3));
    g.setIndex(new THREE.BufferAttribute(leg.index, 1));
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
      if (leg.side < 0) for (let k = 0; k < N * 3; k++) this.nrm[k] = -this.nrm[k]; // 镜像腿的网格绕向相反
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
    // 离开皮肤的距离（贴肤时为 0）
    { const st = this.stretch, p = this.pos, h = this.home, n = this.leg.nrm;
      if (this.active) for (let o = 0, k = 0; o < N; o++, k += 3) st[o * 3 + 2] = (p[k] - h[k]) * n[k] + (p[k + 1] - h[k + 1]) * n[k + 1] + (p[k + 2] - h[k + 2]) * n[k + 2];
      else if (this._hadGap !== false) for (let o = 0; o < N; o++) st[o * 3 + 2] = 0;
      this._hadGap = this.active; }
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
        st[o * 3 + 1] = lv / REST_LV[o];
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
        st[o * 3] = b * v;
      }
    }
  }

  simulate(dt) {
    const pos = this.pos, prev = this.prev, home = this.home, hn = this.leg.nrm;
    const lifted = this.lifted, fixed = this.fixed;
    const j0 = this.j0, j1 = this.j1, tau = this.tension;
    const K = 0.9, SUBS = 2, ITERS = 9;
    fixed.fill(0);
    // 模拟窗口之外的部分始终贴在腿上
    pos.set(home.subarray(0, j0 * NU * 3), 0);
    if (j1 < NV - 1) pos.set(home.subarray((j1 + 1) * NU * 3), (j1 + 1) * NU * 3);
    for (let i = 0; i < NU; i++) { fixed[j0 * NU + i] = 1; fixed[j1 * NU + i] = 1; }

    // 抓取：拉得过远则脱手
    let gOff = null;
    if (this.grabIdx >= 0) {
      const g3 = this.grabIdx * 3;
      const dx = this.target.x - home[g3], dy = this.target.y - home[g3 + 1], dz = this.target.z - home[g3 + 2];
      if (Math.sqrt((dx) ** 2 + (dy) ** 2 + (dz) ** 2) > MAX_PULL) { this.release(); this.onSnap && this.onSnap(); }
      else {
        // 抓取点不能被按进腿里：把位移限制在抓取处皮肤切平面的外侧
        const nd = dx * hn[g3] + dy * hn[g3 + 1] + dz * hn[g3 + 2], e = Math.max(0, 0.0015 - nd);
        gOff = [dx + hn[g3] * e, dy + hn[g3 + 1] * e, dz + hn[g3 + 2] * e];
        for (const g of this.grabSet) fixed[g] = 2;
      }
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
          } else {
            lifted[a] = 1;
            // 刚离开皮肤的一薄层仍被摩擦拖住，不能沿皮肤横向滑动；
            // 否则只受拉的薄膜会在抬起区的边缘滑过相邻顶点、叠成翻面的小三角（渲染出来是黑色块）
            if (d < SLIDE_FREE) {
              const f = (d - EPS_LAND) / (SLIDE_FREE - EPS_LAND), g = f * f * (3 - 2 * f);
              for (let c = 0; c < 3; c++) { const h = home[k + c] + hn[k + c] * d; pos[k + c] = h + (pos[k + c] - h) * g; }
            }
          }
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
