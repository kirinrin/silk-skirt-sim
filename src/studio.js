// 程序化影棚环境：暗房间里的几块柔光箱。丝袜、皮鞋这类有光泽的材质主要靠反射它们来呈现质感
import * as THREE from 'three';

export function makeStudioEnv(renderer) {
  const scene = new THREE.Scene();
  const add = (w, h, pos, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(...pos); m.lookAt(0, 0.7, 0); scene.add(m);
  };
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.030, 0.031, 0.038), side: THREE.BackSide, toneMapped: false })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.075, 0.066, 0.060), toneMapped: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);
  add(2.4, 3.0, [1.9, 2.3, 2.6], 0xfff4e8, 11);     // 主光：右前上方的大柔光箱
  add(0.55, 3.2, [-2.4, 1.5, -1.5], 0xcfdcff, 12);  // 左后方的条形灯：勾出腿的轮廓
  add(0.45, 2.8, [2.7, 1.3, -0.4], 0xffffff, 7);    // 右侧条形灯
  add(3.2, 2.2, [-1.8, 1.2, 3.2], 0xffe6d6, 1.5);   // 左前方的大面积补光
  add(2.2, 2.2, [0, 3.8, 0.3], 0xffffff, 3.5);      // 顶光
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.025).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}
