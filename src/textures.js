// 程序化格纹面料贴图
import * as THREE from 'three';

export const PLAIDS = {
  '棕色格纹': { base: '#a88a74', dark: '#5b4336', light: '#e7d9c8', accent: '#8f4b3a', line: '#f4ece0' },
  '灰色格纹': { base: '#6f6d77', dark: '#3a3943', light: '#a5a3ad', accent: '#2a2932', line: '#e6e4ea' },
  '藏青格纹': { base: '#27334f', dark: '#121a2e', light: '#3f6b5a', accent: '#8b2f37', line: '#e8dfa8' },
  '红色格纹': { base: '#8e2531', dark: '#3d1118', light: '#1f3a2c', accent: '#16182a', line: '#f0e6c8' },
  '纯黑': { base: '#1d1d22', dark: '#1d1d22', light: '#1d1d22', accent: '#1d1d22', line: '#1d1d22' },
  '纯白': { base: '#e9e7e4', dark: '#e9e7e4', light: '#e9e7e4', accent: '#e9e7e4', line: '#e9e7e4' },
};

export const SETT = 0.062; // 一个格纹循环的实际尺寸（米）

export function makePlaid(name, maxAniso = 8) {
  const p = PLAIDS[name] || PLAIDS['棕色格纹'];
  const S = 1024;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = p.base; g.fillRect(0, 0, S, S);
  const bands = [
    [0.00, 0.26, p.dark, 0.55],
    [0.50, 0.14, p.light, 0.50],
    [0.34, 0.022, p.accent, 0.8],
    [0.42, 0.022, p.accent, 0.8],
    [0.115, 0.018, p.line, 0.55],
    [0.78, 0.014, p.dark, 0.7],
    [0.84, 0.014, p.line, 0.5],
  ];
  // 经纱、纬纱分别上色，之后按 2/2 斜纹组织交织
  const warp = document.createElement('canvas'), weft = document.createElement('canvas');
  for (const [c, vertical] of [[warp, true], [weft, false]]) {
    c.width = c.height = S; const x = c.getContext('2d');
    x.fillStyle = p.base; x.fillRect(0, 0, S, S);
    for (const [a0, w, col, al] of bands) {
      x.globalAlpha = Math.min(1, al * 1.5); x.fillStyle = col;
      if (vertical) x.fillRect(a0 * S, 0, w * S, S); else x.fillRect(0, a0 * S, S, w * S);
    }
  }
  const dw = warp.getContext('2d').getImageData(0, 0, S, S).data, df = weft.getContext('2d').getImageData(0, 0, S, S).data;
  const img = g.getImageData(0, 0, S, S), d = img.data;
  const hc = document.createElement('canvas'); hc.width = hc.height = S;
  const hx = hc.getContext('2d'), himg = hx.getImageData(0, 0, S, S), hd = himg.data;
  const Y = 4; // 一根纱线的像素宽度（约 0.24mm）
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const yarnV = new Float32Array(S / Y), yarnH = new Float32Array(S / Y);
  for (let i = 0; i < S / Y; i++) { yarnV[i] = 0.9 + rnd() * 0.2; yarnH[i] = 0.9 + rnd() * 0.2; } // 纱线粗细/颜色不匀
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = Math.floor(x / Y), cy = Math.floor(y / Y), i = (y * S + x) * 4;
    const up = ((cx + cy) & 3) < 2;                         // 2/2 斜纹：经纱在上 or 纬纱在上
    const src = up ? dw : df;
    const fx = (x % Y + 0.5) / Y - 0.5, fy = (y % Y + 0.5) / Y - 0.5;
    const across = up ? fx : fy;                            // 纱线横截面方向
    const round = Math.cos(across * Math.PI);               // 纱线的圆柱起伏
    const tone = (0.80 + 0.26 * round) * (up ? yarnV[cx] : yarnH[cy]) * (up ? 1.04 : 0.95);
    const fuzz = 1 + (rnd() - 0.5) * 0.14;
    d[i] = Math.min(255, src[i] * tone * fuzz); d[i + 1] = Math.min(255, src[i + 1] * tone * fuzz); d[i + 2] = Math.min(255, src[i + 2] * tone * fuzz); d[i + 3] = 255;
    const h = 128 + (up ? 46 : -30) * round + (rnd() - 0.5) * 26;
    hd[i] = hd[i + 1] = hd[i + 2] = h; hd[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); hx.putImageData(himg, 0, 0);

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(hc);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; }
  return { map, bump };
}
