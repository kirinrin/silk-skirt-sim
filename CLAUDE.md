# silk-skirt-sim

three.js 实时演示：可捏起回弹的丝袜 + 百褶裙布料模拟，带“写实 / 动画”两种渲染风格。界面与注释用中文。

## 常用命令

- `npm install`，`npm run dev`（http://localhost:5173），`npm run build`
- `node tools/fit-body.mjs`：从人体网格重新生成 `src/bodydata.js`（改了 tools/fit-body.mjs 或换了源模型后必须重跑）
- `node tools/shot.cjs out.png "<页面里执行的 JS>" [宽 高]`：无头截图（需要 Playwright 和已启动的 dev server）。
  页面暴露了 `window.__app`（`P` 参数、`simulate(dt)`、`camera`、`controls`、`stockings`、`skirt`、`applyStocking()`、`applyLook()` 等），
  截图前可以用它设参数、推进模拟、摆相机。改了渲染或物理后请截图确认，不要只凭代码判断。

## 结构

- `src/body.js`：腿（NU×NV 的 (θ, s) 规则网格，CPU 蒙皮：髋、膝、踝、跖趾）、骨盆/躯干、裙子用的碰撞体。
  另一条腿是运行时镜像的（`side < 0`，索引绕向相反，法线需要取反）。
- `src/bodydata.js`：生成文件，勿手改。
- `tools/fit-body.mjs`：把人体网格重采样成上述规则网格。做法是沿腿的中心线逐圈向外发射射线取交点；
  中心线必须平滑，否则截面会交叉产生褶皱（脚踝处尤其要注意）。名义弧长 s：膝 = 0.42，踝 = 0.82，全长 1.079，
  很多地方（袜口高度、鞋、短裤、膝盖泛红、蒙皮混合区）都按这个 s 写死。
- `src/stockings.js`：丝袜材质（分层着色、纤维高光、线圈微法线、细褶、加固区、背缝）和只受拉的薄膜 PBD 模拟（只模拟抓取点附近的若干行）。
- `src/skirt.js`：裙子 PBD（粗网格）+ 刀褶几何重建（渲染网格）。
- `src/toon.js`：动画风格材质、深度描边后处理、木地板。`src/materials.js`：写实皮肤与针织上衣。`src/studio.js`：程序化影棚环境。
- `src/main.js`：场景、交互、面板、主循环。默认风格可用 `window.__defaultLook` 覆盖。

## 换人体模型时要知道的

- 现在的源模型是 `assets/makehuman/base.obj`（MakeHuman 基础网格，CC0）。`fit-body.mjs` 依赖它自带的关节标记
  （`joint-l-upper-leg` / `joint-l-knee` / `joint-l-ankle` / `joint-ground`）来确定髋、膝、踝和地面；
  没有这些标记的模型需要另外给出或估算关节位置。
- 源模型需要：基本直立、两腿分开的站姿；腿是裸露的皮肤表面（衣服、鞋袜没有和身体融成一体）；腿部面数足够。
- 只需要表面三角形，不需要骨骼或 UV。USD 文本（.usda）里取 `points` 和 `faceVertexIndices` / `faceVertexCounts` 即可。
- 换模型后要重新检查：站姿收拢角度、腰围与裙腰贴合、碰撞体半径、鞋子遮罩与鞋跟、脚趾区域的拟合。

## 约定

- 改动先提交到分支，合并进 `main` 由用户决定。
