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
  const S = 512;
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
  for (const vertical of [true, false]) {
    for (const [a, w, col, al] of bands) {
      g.globalAlpha = al; g.fillStyle = col;
      if (vertical) g.fillRect(a * S, 0, w * S, S); else g.fillRect(0, a * S, S, w * S);
    }
  }
  // 斜纹织法
  g.globalAlpha = 0.10; g.strokeStyle = '#000'; g.lineWidth = 1.2;
  for (let k = -S; k < S * 2; k += 4) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - S, S); g.stroke(); }
  g.globalAlpha = 0.06; g.strokeStyle = '#fff';
  for (let k = -S + 2; k < S * 2; k += 4) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - S, S); g.stroke(); }
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  const bc = document.createElement('canvas'); bc.width = bc.height = 128;
  const b = bc.getContext('2d');
  b.fillStyle = '#808080'; b.fillRect(0, 0, 128, 128);
  b.strokeStyle = '#d0d0d0'; b.lineWidth = 1.6;
  for (let k = -128; k < 256; k += 4) { b.beginPath(); b.moveTo(k, 0); b.lineTo(k - 128, 128); b.stroke(); }

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bc);
  bump.repeat.set(4, 4);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; }
  return { map, bump };
}
