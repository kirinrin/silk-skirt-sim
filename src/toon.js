// 动画风格渲染：赛璐珞（两段色阶）材质、硬边高光、边缘光，以及基于深度的描边后处理
import * as THREE from 'three';

// 腿上的织物/皮肤坐标系（与写实丝袜着色器相同的推导），用来画沿腿长方向的高光条
const FRAME = `
  vec2 cs = normalize(vSUV.xy);
  vec3 pV = -vViewPosition, dpx = dFdx(pV), dpy = dFdy(pV);
  float dsx = dFdx(vSUV.z), dsy = dFdy(vSUV.z);
  vec3 tA = dpx * dsy - dpy * dsx;
  vec3 Tt = length(tA) > 1e-12 ? normalize(tA) : vec3(1., 0., 0.);
  Tt = normalize(Tt - normal * dot(Tt, normal));`;

// 色阶 + 边缘光 + 可选的高光条。I 是“受光量”，已包含阴影贴图，所以裙子的投影也是硬边的
const CEL = `
  float I = dot(reflectedLight.directDiffuse, vec3(.3333)) / max(dot(diffuseColor.rgb, vec3(.3333)), 1e-3);
  float lit = smoothstep(uTh - uSoft, uTh + uSoft, I);
  vec3 Vv = normalize(vViewPosition);
  float ndv = saturate(dot(normal, Vv));
  vec3 cel = mix(diffuseColor.rgb * uShade, diffuseColor.rgb, lit);
  cel = mix(cel, cel * uShade, (1. - smoothstep(uTh * .28 - uSoft, uTh * .28 + uSoft, I)) * uDeep);   // 更深的第二段阴影
  float rimMask = smoothstep(.60, .66, 1. - ndv) * lit;
  cel += uRim * rimMask;`;
const STREAK = `
  float hl = 0.;
  #if NUM_DIR_LIGHTS > 0
  {
    ${FRAME}
    vec3 L = directionalLights[0].direction, Hh = normalize(L + Vv);
    float a1 = dot(Tt, Hh);
    float lobe = pow(max(1. - a1 * a1, 0.), uSpecPow) * saturate(dot(normal, L) * 2.5);
    // 高光条不是一整根：沿腿长被打断成几段，膝盖处最亮
    float seg = .62 + .38 * sin(vSUV.z * 17. + 1.2) + .35 * exp(-pow((vSUV.z - .43) / .05, 2.));
    hl = smoothstep(.80, .86, lobe * seg) * lit * smoothstep(.35, .6, ndv);
  }
  #endif`;

export function makeToon(o = {}) {
  const u = {
    uShade: { value: new THREE.Color(...(o.shade || [0.72, 0.68, 0.80])) },
    uRim: { value: new THREE.Color(...(o.rim || [0, 0, 0])) },
    uTh: { value: o.th ?? 0.30 }, uSoft: { value: o.soft ?? 0.012 }, uDeep: { value: o.deep ?? 0 },
    uSpec: { value: o.streak || 0 }, uSpecPow: { value: o.specPow || 9 },
  };
  const mat = new THREE.MeshLambertMaterial({
    color: o.color ?? 0xffffff, map: o.map || null, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide,
  });
  mat.userData.uniforms = u;
  const suv = !!(o.streak || o.mask);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (suv) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSUV; varying vec3 vSUV;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUV = aSUV;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uShade, uRim; uniform float uTh, uSoft, uDeep, uSpec, uSpecPow;
        ${suv ? 'varying vec3 vSUV;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.mask || ''}`)
      .replace('#include <opaque_fragment>', `
        {
          ${CEL}
          ${o.streak ? STREAK + '\ncel = mix(cel, vec3(1.), hl * uSpec);' : ''}
          outgoingLight = cel;
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

// 动画风格丝袜：色阶明暗 + 平滑的透肤渐变（中间透、边缘实）+ 硬边高光条
export function makeToonStocking(uniforms) {
  const u = {
    ...uniforms, // 与写实材质共用 uDensity / uTop / uBand / uSeam / uReinf / uGloss / uShine
    uShade: { value: new THREE.Color(0.6, 0.6, 0.7) }, uRim: { value: new THREE.Color(0, 0, 0) },
    uTh: { value: 0.30 }, uSoft: { value: 0.012 }, uDeep: { value: 0 }, uSpecPow: { value: 9 },
  };
  const mat = new THREE.MeshLambertMaterial({ color: 0x0e0e12, transparent: true, side: THREE.DoubleSide, depthWrite: true });
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aStretch; attribute vec3 aSUV; varying vec2 vStretch; varying vec3 vSUV;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStretch = aStretch; vSUV = aSUV;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vStretch; varying vec3 vSUV;
        uniform vec3 uShade, uRim; uniform float uTh, uSoft, uDeep, uSpecPow;
        uniform float uDensity, uGloss, uShine, uTop, uBand, uSeam, uReinf;
        float sDens, sBand;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vSUV.z < uTop) discard;
        {
          vec2 c2 = normalize(vSUV.xy);
          sDens = uDensity * 2.4 / pow(max(vStretch.x, .25), 1.3);
          sBand = uBand > 0. ? 1. - smoothstep(uTop + uBand, uTop + uBand + .002, vSUV.z) : 0.;
          sDens = mix(sDens, sDens * 3. + 1.4, sBand);
          float toe = smoothstep(.992, .996, vSUV.z);
          float heel = smoothstep(.802, .808, vSUV.z) * (1. - smoothstep(.890, .896, vSUV.z)) * smoothstep(-.05, -.12, c2.y);
          sDens += uReinf * (toe + heel) * (1.2 + sDens);
          float seam = (1. - smoothstep(.014, .018, abs(c2.x))) * step(c2.y, 0.) * (1. - smoothstep(.84, .86, vSUV.z));
          sDens += uSeam * seam * 8.;
          diffuseColor.rgb *= 1. - sBand * .12;
        }`)
      .replace('#include <opaque_fragment>', `
        {
          ${CEL}
          ${STREAK}
          float gz = 1. - ndv;
          float a = 1. - exp(-sDens * (1. + 2.2 * gz * gz) / max(ndv, .12));
          float s = hl * (.25 + .6 * uGloss) * min(uShine * 1.4, 1.);
          cel = mix(cel, vec3(1.), s);
          diffuseColor.a = clamp(a + s, 0., 1.);
          outgoingLight = cel;
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

// 描边：对线性深度做拉普拉斯，轮廓、裙褶台阶、捏起的丝袜边缘都会出线；线的颜色取邻域里最深的颜色再压暗（彩色描线）
export class OutlinePass {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 30 }, uWidth: { value: 1.3 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `
        uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uWidth; varying vec2 vUv;
        float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          vec2 o = uTexel * uWidth;
          float d = lin(vUv);
          float dl = lin(vUv - vec2(o.x, 0.)), dr = lin(vUv + vec2(o.x, 0.)), dd = lin(vUv - vec2(0., o.y)), du = lin(vUv + vec2(0., o.y));
          float dmin = min(d, min(min(dl, dr), min(dd, du)));
          float lap = abs(dl + dr + dd + du - 4. * d) / dmin;
          float e = smoothstep(.010, .028, lap);
          vec3 c = texture2D(tColor, vUv).rgb;
          vec3 c1 = texture2D(tColor, vUv - vec2(o.x, 0.)).rgb, c2 = texture2D(tColor, vUv + vec2(o.x, 0.)).rgb;
          vec3 c3 = texture2D(tColor, vUv - vec2(0., o.y)).rgb, c4 = texture2D(tColor, vUv + vec2(0., o.y)).rgb;
          vec3 dk = c; float m = dot(c, vec3(1.));
          if (dot(c1, vec3(1.)) < m) { dk = c1; m = dot(c1, vec3(1.)); }
          if (dot(c2, vec3(1.)) < m) { dk = c2; m = dot(c2, vec3(1.)); }
          if (dot(c3, vec3(1.)) < m) { dk = c3; m = dot(c3, vec3(1.)); }
          if (dot(c4, vec3(1.)) < m) { dk = c4; }
          vec3 line = dk * vec3(.34, .24, .28);
          gl_FragColor = vec4(mix(c, line, e), 1.);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.cam = new THREE.Camera();
  }
  setSize(w, h, dpr) {
    const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
    this.rt.setSize(W, H);
    this.mat.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.mat.uniforms.uWidth.value = 1.15 * dpr;
  }
  render(scene, camera) {
    const r = this.renderer;
    this.mat.uniforms.uNear.value = camera.near; this.mat.uniforms.uFar.value = camera.far;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.quad, this.cam);
  }
}
