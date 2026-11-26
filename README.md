# ParticleFlow

English | [简体中文](README.zh-CN.md)

> A screen full of solid **3 mm particles** behaves like sand inside a phone-sized container. Gravity piles it up, particles collide with one another and the walls, and tilting or shaking the phone makes the sand flow.
>
> Built with **Vue 3 + PixiJS (WebGL)**. It runs as a standalone web page and may later be packaged for **Wallpaper Engine**.

## Features

- **Particle size:** approximately 3 mm in CSS physical units.
- **Particle count:** calculated from the screen size; particles cover about half the screen area (around 1,600 on a phone and 10,000 on a 1080p desktop).
- **Container physics:**
  1. Gravity makes the sand fall and settle at the bottom.
  2. Particle collisions let the sand compress and form piles, with friction and very little bounce.
  3. Wall collisions keep particles inside the screen.
  4. Phone orientation changes the direction of gravity.
  5. Linear acceleration adds inertial force when the phone is shaken.

## Technology

| Area | Technology | Notes |
|---|---|---|
| Framework | Vue 3 (`<script setup>`) + TypeScript | Components handle mounting and UI status; core logic lives in TypeScript modules. |
| Build | Vite 6 | `base: './'` lets the output load from `file://` and Wallpaper Engine. |
| Rendering | PixiJS 8 (WebGL with automatic fallback) | A pre-rendered particle texture is tinted and rendered as batched sprites. |
| Physics | Lightweight custom particle engine | Semi-implicit Euler, fixed substeps, and spatial-hash collision detection; no third-party physics dependency. |
| Input | Android `DeviceOrientationEvent` and `DeviceMotionEvent` | Orientation controls gravity; linear acceleration supplies shake force. |
| HTTPS development | `@vitejs/plugin-basic-ssl` | Sensor APIs require a secure context. |

## Getting Started

### Requirements

Node.js 20.19+ or 22.12+ (tested with Node 24).

```bash
npm install        # Install dependencies
npm run dev        # HTTPS development server, accessible on the local network
npm run dev:http   # HTTP preview for desktop; phone sensors are unavailable
npm run build      # Type-check and create the production build in dist/
npm run preview    # Preview the production build locally
```

### Test on an Android phone

1. Connect the phone and computer to the same local network.
2. Run `npm run dev`. The terminal prints a network URL such as `https://192.168.x.x:5173`.
3. Open that URL in Chrome on Android.
4. For the self-signed certificate, choose **Advanced** and continue to the site.
5. Grant motion-sensor permission if prompted.
6. Tilt the phone to move the sand; shake it to throw the particles.

> **Why HTTPS?** Browsers expose sensor APIs only in secure contexts such as HTTPS or localhost. Over `http://IP`, no sensor data is available; the page reports that no gyroscope was detected and uses only vertical gravity.

## Project Structure

```text
ParticleFlow/
├── index.html                     # Full-screen entry page and mobile viewport settings
├── package.json                   # Dependencies and dev/build/preview scripts
├── tsconfig.json                  # Strict TypeScript configuration
├── vite.config.ts                 # Vue plugin, self-signed HTTPS, and base: './'
├── public/
│   └── wallpaper/
│       └── project.json           # Reserved Wallpaper Engine template
└── src/
    ├── main.ts                    # Vue application entry point
    ├── App.vue                    # Root component and ParticleCanvas host
    ├── components/
    │   └── ParticleCanvas.vue     # PixiJS setup, rendering, status, lifecycle, resize handling
    ├── engine/
    │   └── particles.ts           # Gravity, particle and wall collisions, friction, restitution
    ├── input/
    │   ├── tilt.ts                # TiltProvider interface and input state types
    │   └── deviceOrientation.ts   # Android orientation and motion sensor provider
    └── utils/
        └── size.ts                # 3 mm-to-pixel conversion and particle-count formula
```

## How It Works

### Particle size and coverage

The CSS reference is $1\,\text{in} = 96\,\text{px}$, so $1\,\text{mm} = \frac{96}{25.4} \approx 3.78\,\text{px}$. A 3 mm particle is about 11.3 CSS pixels across. Rendering also accounts for `devicePixelRatio`, capped at 2.

The particle count is calculated from the display dimensions:

$$N = \frac{0.5 \times S_{\text{screen}}}{S_{\text{particle}}} = \frac{0.5 \times W \times H}{\pi r^2}$$

Once settled, the sand forms a pile covering roughly half the container.

### Particle physics

Each particle is a disk with mass and follows:

$$\vec{a} = \vec{g}_{\text{dir}} \cdot G + \vec{a}_{\text{shake}} + \text{contact forces (particles and walls)}$$

- **Solver:** Position-Based Dynamics (PBD). The engine integrates velocity to predict positions, iteratively resolves overlap and position-level Coulomb friction, then derives velocity from position change ($v = \Delta x / h$). Wall projection closes every iteration.
- **Support propagation:** constraints are solved from the bottom of the pile upward so support propagates through deep stacks and settles quickly.
- **Particle collisions:** equal-mass disks are separated according to their weights; restitution is near zero so the sand does not bounce.
- **Friction:** tangential sliding is reduced subject to the Coulomb limit ($|\Delta_t| \leq \mu \times$ normal correction, with `FRICTION` as $\mu$). Below the static friction angle $\arctan(\mu) \approx 4.6^\circ$, particles remain still; above it, they slide under gravity.
- **Walls:** position projection prevents particles from leaving the screen; fast impacts have a small bounce.
- **Broad phase:** a spatial hash with cell size equal to the particle diameter checks only the 3×3 neighboring cells.
- **Sleep:** sleep is only a power-saving optimization. A particle sleeps after remaining slow for `SLEEP_TIME` (2.5 seconds). Sleeping particles wake immediately when gravity direction has cumulatively changed by more than `WAKE_GRAVITY_DEG` (4 degrees).

### Sensor processing

Orientation is smoothed with an EMA low-pass filter. Motion is smoothed and transformed into screen coordinates; shake force is the negative linear acceleration.

```text
deviceorientation (β, γ)                devicemotion (linear acceleration a)
          │                                           │
          ▼                                           ▼
   EMA low-pass filter                       EMA smoothing + coordinate transform
          │                                           │
          ▼                                           ▼
 gravity direction:                          shake force = -a
   gx = cos(β) · sin(γ)
   gy = sin(β)
```

- At β = 90° (portrait), `gy = 1`, so gravity points down the screen. When the phone lies flat, gravity is perpendicular to the screen and the sand stays still; when held upside down, the sand falls upward on screen.
- If no sensor data arrives within 3 seconds, the page reports that no gyroscope was detected. HTTP access or disabled sensors are common causes.
- **Android is currently supported.** iOS requires `requestPermission()` and is listed on the roadmap.

## Tuning

| File | Constant | Description | Default |
|---|---|---|---|
| `src/utils/size.ts` | `PARTICLE_DIAMETER_MM` | Particle diameter | `3` |
| `src/utils/size.ts` | `COVERAGE` | Fraction of screen area covered | `0.5` |
| `src/engine/particles.ts` | `GRAVITY` | Acceleration in px/s² | `2200` |
| `src/engine/particles.ts` | `FRICTION` | Coulomb friction μ; higher values allow steeper piles | `0.08` |
| `src/engine/particles.ts` | `WALL_E` | Small bounce on fast wall impacts | `0.2` |
| `src/engine/particles.ts` | `SUBSTEPS` | Physics substeps | `2` |
| `src/engine/particles.ts` | `PBD_ITER` | Position solver iterations per substep | `6` |
| `src/engine/particles.ts` | `SLOP` | Position tolerance | `0.05` |
| `src/engine/particles.ts` | `SLEEP_TIME` | Time before sleeping, in seconds | `2.5` |
| `src/engine/particles.ts` | `WAKE_GRAVITY_DEG` | Cumulative gravity-direction change to wake | `4` |
| `src/engine/particles.ts` | `G_MIN_LEN` | Minimum in-plane gravity magnitude | `0.08` |
| `src/input/deviceOrientation.ts` | `SHAKE_GAIN` | Shake sensitivity | `225` |
| `src/input/deviceOrientation.ts` | `SMOOTH_ALPHA` | Orientation smoothing factor | `0.15` |
| `src/input/deviceOrientation.ts` | `TILT_SIGN_X / Y` | Gravity direction sign; set to `-1` to invert | `1` |
| `src/components/ParticleCanvas.vue` | `PARTICLE_COLOR` | Particle color | `0x9adcff` |
| `src/App.vue` | `background` | Page background gradient | Deep blue |

## FAQ

- **The page is black or particles do not move.** Check the browser DevTools console. WebGL shader errors are reported through `console.error` rather than thrown as exceptions.
- **Tilting does not move the sand, or it moves the wrong way.** Confirm the page uses HTTPS and accept the self-signed certificate. Some browsers require a tap before enabling sensors. If `event.acceleration` is null, shaking will not work, but tilt should still work.
- **The pile jitters or particles overlap.** Stability comes from PBD, bottom-up constraint solving, a small tolerance, and wall projection. Increase `PBD_ITER` (for example, to 8); if overlap is severe, increase `SUBSTEPS` (for example, to 3) at additional CPU cost.
- **The phone gets hot or drains battery.** Rendering resolution is capped at 2, physics substeps scale down with particle count, and rendering pauses when the page is in the background.
- **Particles are too large or small.** Change `PARTICLE_DIAMETER_MM`. CSS millimeters are approximate; device DPI reporting may cause about ±10% variation.

## Roadmap

- [ ] **iOS support:** request `DeviceOrientationEvent` permission from a user gesture.
- [ ] **Desktop mouse input:** implement `TiltProvider` in `src/input/mouseProvider.ts`; dragging can simulate shaking without changing the engine or renderer.
- [ ] **Wallpaper Engine:** run `npm run build`, then copy the contents of `dist/` and `public/wallpaper/project.json` into `wallpaper_engine/projects/myprojects/particle-flow/`. Provide a `preview.png` referenced by `project.json`. Wallpaper Engine has no gyroscope, so mouse input will be needed to move the sand. The project template reserves a `supportsaudioprocessing` hook for possible audio reactivity.
- [ ] Optional improvements: skip simulation for sleeping particles, vary particle sizes, and add color themes.

## Git Notes

- `.gitignore` excludes `node_modules/` and `dist/`; run `npm install` after cloning.
- `package-lock.json` is tracked for reproducible dependencies.
- Consider separate milestone commits for scaffolding, rendering, physics, sensor input, and build setup.# 粒子流动 ParticleFlow

> 满屏 **3mm 实心圆点**组成的一把"沙子"，装在手机屏幕这个**容器**里：
> 受**重力**堆积、**粒子间真实碰撞**、**与四壁碰撞**——转动手机沙子流向倾斜方向，晃动手机沙子被甩起来。
> 技术栈 **Vue 3 + PixiJS (WebGL)**。可独立作为网页打开，未来可打包接入 Steam **Wallpaper Engine**。

---

## 1. 效果说明

- **粒子**：直径约 3mm 的实心圆点（按 CSS 物理尺寸换算，手机上肉眼即物理 3mm）。
- **数量**：按屏幕尺寸自动计算，总面积约占屏幕一半（手机约 1,600 个，桌面 1080p 约 10,000 个）。
- **物理**（屏幕 = 容器，粒子 = 沙子）：
  1. **重力**——沙子自然下落、堆积在容器底部；
  2. **粒子间碰撞**——互相挤压、堆叠成沙堆，有摩擦、几乎不弹；
  3. **四壁碰撞**——不会溢出屏幕；
  4. **倾斜**——重力方向随手机姿态变化，沙堆整体流向倾斜方向；
  5. **晃动**——加速度计提供惯性力，手机一甩沙子跟着飞。

## 2. 技术栈

| 层面 | 选型 | 说明 |
|---|---|---|
| 框架 | Vue 3（`<script setup>`）+ TypeScript | 组件只管挂载与 UI 提示，逻辑在纯 TS 模块 |
| 构建 | Vite 6 | `base: './'`，产物可被 file:// / Wallpaper Engine 直接加载 |
| 渲染 | PixiJS 8（WebGL，自动降级） | 圆点预渲染成纹理 + tint 上色，批量 Sprite 渲染 |
| 物理 | 自研轻量沙箱引擎 | 半隐式欧拉 + 固定子步 + 空间哈希碰撞检测（无第三方依赖） |
| 输入 | `DeviceOrientationEvent` + `DeviceMotionEvent`（Android） | 姿态角→重力方向；线性加速度→晃动惯性力 |
| 开发 HTTPS | `@vitejs/plugin-basic-ssl` | 传感器 API 仅在安全上下文开放 |

## 3. 快速开始

### 环境要求

Node.js 20.19+ / 22.12+（实测 Node 24）。

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（默认 HTTPS，监听局域网）
npm run dev:http   # 纯 HTTP 模式（桌面快速预览；此模式下手机传感器不可用）
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 本地预览构建产物
```

### Android 真机调试（传感器必读）

1. 手机与电脑连接**同一局域网**；
2. 运行 `npm run dev`，终端会显示 `Network: https://192.168.x.x:5173`；
3. 用 Android Chrome 打开该地址；
4. 首次会提示**证书不受信任**（自签证书）→ 「高级」→「继续前往」；
5. 部分机型首次会弹出**运动传感器权限**请求 → 允许；
6. 转动手机 → 沙堆流向倾斜方向；晃动手机 → 沙子被甩动。

> **为什么必须 HTTPS？** 浏览器只在安全上下文（HTTPS / localhost）下开放传感器 API。
> 用 `http://IP` 访问时拿不到任何数据（页面顶部会出现"未检测到陀螺仪"提示，沙子只受竖直重力）。

## 4. 目录结构（逐文件说明）

```
ParticleFlow/
├── index.html                     # 入口页面：全屏容器 + 移动端 viewport 设置
├── package.json                   # 依赖与脚本（dev / dev:http / build / preview）
├── tsconfig.json                  # TypeScript 严格模式配置
├── vite.config.ts                 # Vue 插件 + 自签 HTTPS + base:'./'（WE 兼容）
├── public/
│   └── wallpaper/
│       └── project.json           # Wallpaper Engine 打包模板（预留，见 §8）
└── src/
    ├── main.ts                    # 应用入口，挂载 Vue 根组件
    ├── App.vue                    # 根组件：深蓝渐变背景 + 挂载 ParticleCanvas
    ├── components/
    │   └── ParticleCanvas.vue     # 核心组件：PixiJS 初始化、粒子渲染、状态提示、
    │                              #   生命周期（后台暂停）、窗口尺寸变化自适应
    ├── engine/                    # 仿真层（纯 TS，与渲染完全解耦）
    │   └── particles.ts           # 沙箱物理：重力积分、粒子碰撞（空间哈希）、
    │                              #   四壁碰撞、摩擦与恢复系数
    ├── input/                     # 输入层
    │   ├── tilt.ts                # TiltProvider 接口 + 状态类型（未来鼠标模式的扩展缝）
    │   └── deviceOrientation.ts   # Android 传感器实现：姿态角→重力方向（物理公式）、
    │                              #   线性加速度→晃动惯性力、3 秒无数据降级提示
    └── utils/
        └── size.ts                # 3mm→px 换算、粒子数量公式
```

## 5. 核心原理

### 5.1 粒子规格（3mm + 半屏覆盖）

CSS 标准 $1\,\text{in} = 96\,\text{px}$，故 $1\,\text{mm} = \frac{96}{25.4} \approx 3.78\,\text{px}$，直径 $3\,\text{mm} \approx 11.3\,\text{CSS px}$（渲染时再乘 `devicePixelRatio`，上限 2）。

粒子数量由公式自动计算，无需写死：

$$N = \frac{0.5 \times S_{\text{screen}}}{S_{\text{particle}}} = \frac{0.5 \times W \times H}{\pi r^2}$$

沙子静止后会堆积在容器底部，形成约占半屏的沙堆。

### 5.2 沙箱物理模型

每个粒子是一个有质量的小圆盘，运动方程：

$$\vec{a} = \vec{g}_{\text{dir}} \cdot G + \vec{a}_{\text{shake}} + \text{接触力（碰撞/墙壁）}$$

- **求解器**：PBD 位置法（Position-Based Dynamics，影视/游戏沙粒模拟的标准做法）：
  1. 速度积分 → 预测位置；
  2. 多轮位置约束迭代（重叠推开 + 位置级库仑摩擦，每轮以墙壁投影收尾），且**自底向上**求解——支撑力从堆底逐层向上传播，深层堆叠快速收敛；
  3. **速度由位置变化量导出**（$v = \Delta x / h$）——位置与速度天然同步，根除深层堆叠的高频振铃；
- **粒子碰撞**（等质量圆）：按权重推开超出容差的重叠，恢复系数≈0（沙子不弹）；
- **位置级库仑摩擦**：每轮迭代尝试完全消除接触切向滑移，但受库仑锥限幅（$|\Delta_t| \le \mu \times$ 法向修正量，$\mu$=`FRICTION`）；驱动超过静摩擦角 $\arctan(\mu)\approx4.6°$ 时滑移消不完 → 真实滑动、重力持续加速，沙子会一直流到新的低处。静止感直接来自库仑摩擦本身（倾角小于静摩擦角 = 纹丝不动），不依赖睡眠；
- **四壁碰撞**：位置投影约束 + 快速撞墙微反弹；
- **加速结构**：空间哈希网格（cell 边长 = 粒子直径），只检测 3×3 邻域，O(n) 重建；
- **静置不抖的保障**（从求解器根治，而非用睡眠掩盖）：
  1. **PBD 位置法**——速度永远等于位置变化量，不存在“推了位置没改速度”的能量泵；
  2. **自底向上求解**——约束按深度排序、每对只从较深一方解一次，支撑从堆底逐层向上传播，深层堆叠一两轮迭代即收敛（乱序求解支撑传不下去 → 底层压穿-回弹振铃）；
  3. **小容差 + 投影收尾**——`SLOP` 远小于每子步重力下沉量，多点接触每子步即时承压，不会“蓄力-猛弹”；每轮迭代以墙壁投影收尾，导出速度不含穿墙伪影。
- **睡眠 = 纯省电优化**：只有粒子低速持续 `SLEEP_TIME`（2.5s，手机放着不动的场景）才冻结跳过计算；醒着时的静置稳定全靠上面的求解器收敛。唤醒零等待：每粒沙记住**入睡时的重力方向**，朝向累计偏转 >4°（≈静摩擦角）当帧即醒——无论转多慢、何时转。

### 5.3 传感器处理管线

```
deviceorientation (β, γ)                    devicemotion (线性加速度 a)
        │                                          │
        ▼                                          ▼
  EMA 低通滤波                              EMA 平滑 + 坐标系转换
        │                                          │
        ▼                                          ▼
  重力方向（物理公式，无需零点基准）：        晃动惯性力 = -a（手机一甩沙子飞）
    gx = cos(β)·sin(γ)
    gy = sin(β)
```

- β=90°（竖屏直立）时 `gy=1`，重力直指屏幕下方；**平放**时重力垂直屏幕、沙子不动；**倒持**时沙子往"上"落——和真实沙子一致；
- 监听开始后 **3 秒**收不到任何数据 → 判定"未检测到陀螺仪"（多为 HTTP 访问或传感器被禁用）；
- 本项目**只适配 Android**；iOS 需 `requestPermission()`，见路线图。

## 6. 参数调优

想改效果，只需动这些常量：

| 文件 | 常量 | 含义 | 默认值 |
|---|---|---|---|
| `src/utils/size.ts` | `PARTICLE_DIAMETER_MM` | 粒子直径 | `3` |
| `src/utils/size.ts` | `COVERAGE` | 覆盖屏幕面积比例 | `0.5` |
| `src/engine/particles.ts` | `GRAVITY` | 重力加速度（px/s²） | `2200` |
| `src/engine/particles.ts` | `FRICTION` | 库仑摩擦 μ（静摩擦角 atan(μ)，越大沙堆越陡） | `0.08` |
| `src/engine/particles.ts` | `WALL_E` | 快速撞墙微反弹系数 | `0.2` |
| `src/engine/particles.ts` | `SUBSTEPS` | 物理子步数 | `2` |
| `src/engine/particles.ts` | `PBD_ITER` | 每子步位置求解迭代（堆叠稳定性） | `6` |
| `src/engine/particles.ts` | `SLOP` | 位置容差（须远小于每子步重力下沉量） | `0.05` |
| `src/engine/particles.ts` | `SLEEP_TIME` | 静止多久后休眠省电（秒，仅长期静置用） | `2.5` |
| `src/engine/particles.ts` | `WAKE_GRAVITY_DEG` | 唤醒的朝向累计偏转角（≈静摩擦角） | `4` |
| `src/engine/particles.ts` | `G_MIN_LEN` | 面内重力最小有效值（低于视为平放） | `0.08` |
| `src/input/deviceOrientation.ts` | `SHAKE_GAIN` | 晃动灵敏度 | `225` |
| `src/input/deviceOrientation.ts` | `SMOOTH_ALPHA` | 姿态平滑系数 | `0.15` |
| `src/input/deviceOrientation.ts` | `TILT_SIGN_X / Y` | 重力方向（反了改 `-1`） | `1` |
| `src/components/ParticleCanvas.vue` | `PARTICLE_COLOR` | 粒子颜色 | `0x9adcff` |
| `src/App.vue` | `background` | 页面底色渐变 | 深蓝夜空 |

## 7. 常见问题（FAQ）

- **页面打开是黑的 / 粒子不动？**
  打开浏览器 DevTools 看 Console。WebGL 着色器错误只打印 console.error 不抛异常，需看日志。
- **转动手机沙子不流动 / 方向不对？**
  ① 确认地址栏是 `https://`（传感器 API 仅在安全上下文可用，自签证书需"高级→继续前往"）；
  ② 页面需先触摸/点击一次（部分浏览器要求用户手势后才授权传感器）；
  部分浏览器不提供不含重力的线性加速度（`e.acceleration` 为 null），此时晃动失效但倾斜正常。
- **沙堆静止后还在抖 / 穿模？**
  静置稳定由求解器收敛保证（PBD + 自底向上求解 + 小容差 + 投影收尾），醒着时静置即应完全静止。若仍有轻微抖动：
  调大 `PBD_ITER`（如 8）；穿模严重则增大 `SUBSTEPS`（如 3，开销更高）。
- **手机发烫 / 耗电快？**
  渲染分辨率已上限 2；物理子步数随粒子数自动降档；页面切后台会自动暂停渲染。
- **粒子太大 / 太小？**
  改 `PARTICLE_DIAMETER_MM`；3mm 是 CSS 标准 mm 的近似，个别设备 DPI 上报不准会有 ±10% 误差。

## 8. 路线图（Roadmap）

- [ ] **iOS 适配**：`DeviceOrientationEvent.requestPermission()` + 用户手势触发授权按钮。
- [ ] **桌面鼠标模式**：新增 `src/input/mouseProvider.ts` 实现 `TiltProvider` 接口（鼠标拖动 = 晃动容器），引擎与渲染层零改动。
- [ ] **Wallpaper Engine 接入**：
  1. `npm run build`；
  2. 把 `dist/` 内全部文件与 `public/wallpaper/project.json` 拷入
     `wallpaper_engine/projects/myprojects/particle-flow/`（`project.json` 里的 `preview.png` 需自备一张预览图）；
  3. 在 WE 中选择该壁纸。注意：WE 是桌面软件、无陀螺仪，届时沙子靠鼠标"晃容器"驱动；
     `project.json` 已预留 `supportsaudioprocessing` 钩子位，未来可做音频反应。
- [ ] 可选增强：粒子睡眠优化（静止沙子跳过计算）、粒径分布更像真沙、配色主题切换。

## 9. Git 说明

- `.gitignore` 已忽略 `node_modules/`、`dist/` 等，克隆后 `npm install` 即可恢复开发环境；
- `package-lock.json` 已纳入版本管理（保证依赖可复现）；
- 建议按里程碑提交（脚手架 / 粒子渲染 / 沙箱物理 / 传感器输入 / 构建收尾各一个 commit）。
