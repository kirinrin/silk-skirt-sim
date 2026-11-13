// 皮肤与针织上衣的程序化细节（不依赖贴图）
import * as THREE from 'three';

const NOISE = `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y);
  }`;
// 主光的阴影系数（主光是第一个投影的平行光）
const SHADOW0 = `
  float keyShadow() {
    #if NUM_DIR_LIGHT_SHADOWS > 0
    return getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
    #else
    return 1.;
    #endif
  }`;

// 皮肤：毛孔微法线、肤色不匀、粗糙度变化、明暗交界处偏红的次表面散射
export function createSkinMaterial(color) {
  const mat = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.5, vertexColors: true,
    sheen: 0.35, sheenColor: 0xff8866, sheenRoughness: 0.5, specularIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSUV; varying vec3 vSUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUV = aSUV;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSUV; vec2 kQ; vec3 kTa, kTb; float kFade;
        ${NOISE}`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${SHADOW0}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 cs = normalize(vSUV.xy);
          kQ = vec2(atan(cs.y, cs.x) * .055, vSUV.z);          // 近似成“米”的表面坐标
          vec3 pV = -vViewPosition, dpx = dFdx(pV), dpy = dFdy(pV);
          float dthx = cs.x * dFdx(vSUV.y) - cs.y * dFdx(vSUV.x), dthy = cs.x * dFdy(vSUV.y) - cs.y * dFdy(vSUV.x);
          float dsx = dFdx(vSUV.z), dsy = dFdy(vSUV.z);
          vec3 tA = dpx * dsy - dpy * dsx, tB = dpy * dthx - dpx * dthy;
          kTa = length(tA) > 1e-12 ? normalize(tA) : vec3(1., 0., 0.);
          kTb = length(tB) > 1e-12 ? normalize(tB) : vec3(0., 1., 0.);
          kFade = 1. - smoothstep(.15, .5, length(vec2(dsx, dsy)) * 2600.);
          // 肤色不匀：大块的红润 / 偏黄 + 细碎斑驳
          float m1 = vnoise(kQ * 38.) - .5, m2 = vnoise(kQ * 160. + 7.) - .5, m3 = vnoise(kQ * 9. + 3.) - .5;
          diffuseColor.rgb *= vec3(1. + m1 * .05 + m3 * .05, 1. - m1 * .035 + m2 * .03, 1. - m1 * .06 + m2 * .03 - m3 * .04);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (vnoise(kQ * 420.) - .5) * .22 * kFade + (vnoise(kQ * 30.) - .5) * .08, .25, 1.);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // 毛孔与皮纹：对高频噪声做有限差分
          float e = .00018, k = 2600.;
          float n0 = vnoise(kQ * k) + .5 * vnoise(kQ * k * 2.3 + 5.);
          float nx = vnoise((kQ + vec2(e, 0.)) * k) + .5 * vnoise((kQ + vec2(e, 0.)) * k * 2.3 + 5.);
          float ny = vnoise((kQ + vec2(0., e)) * k) + .5 * vnoise((kQ + vec2(0., e)) * k * 2.3 + 5.);
          vec3 bump = (kTa * (nx - n0) + kTb * (ny - n0)) * (.32 * kFade);
          normal = normalize(normal - (bump - normal * dot(bump, normal)));
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
          // 次表面散射：光绕过明暗交界线，并带上血色
          float nl = dot(normal, directionalLights[i].direction);
          float wrap = saturate((nl + .45) / 1.45) - saturate(nl);
          vec3 lc = directionalLights[i].color; if (i == 0) lc *= mix(.25, 1., keyShadow());
          reflectedLight.directDiffuse += lc * diffuseColor.rgb * vec3(1., .30, .20) * wrap * .30;
        }
        #endif`);
  };
  return mat;
}

// 罗纹针织上衣：竖向罗纹 + V 形线圈
export function createKnitMaterial(color) {
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 0.8, sheenColor: 0xfff4e6, sheenRoughness: 0.75 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; float kRib, kSt, kAng, kFade;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          kAng = atan(vObj.z - .04, vObj.x) * 52.;               // 约 52 条罗纹
          float da = length(vec2(dFdx(kAng), dFdy(kAng)));
          kFade = 1. - smoothstep(.6, 1.8, da);
          kRib = cos(kAng);
          // 每条罗纹上的 V 形线圈
          float v = vObj.y * 330. + abs(fract(kAng / 6.2832) - .5) * 3.2;
          kSt = sin(v * 6.2832) * (1. - smoothstep(.25, .8, fwidth(v)));
          diffuseColor.rgb *= 1. - (.20 - .20 * kRib) * kFade * .6 - .07 * kSt * step(0., kRib);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 up = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);
          vec3 tA = normalize(cross(up, normal));
          vec3 bump = tA * (-sin(kAng) * .55 * kFade) + up * (cos(vObj.y * 330. * 6.2832) * .18 * abs(kSt));
          normal = normalize(normal - (bump - normal * dot(bump, normal)));
        }`);
  };
  return mat;
}
