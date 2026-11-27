# 粒子流动 ParticleFlow

[English](README.md) | 中文

> ParticleFlow 是一个基于 **Vue 3 + PixiJS (WebGL)** 的网页沙粒模拟项目：屏幕是容器，沙粒会受重力、碰撞和摩擦而堆积；在 Android 手机上倾斜或晃动设备，可以让沙粒流动。
>
> 项目目前以独立网页运行。我计划后续将它接入 **Wallpaper Engine**，制作成可交互的动态壁纸；该集成目前尚未完成。
>
> 欢迎提交功能建议、设备兼容性反馈或可复现的问题。较大的改动建议先开 Issue 讨论方案，再投入 Pull Request。

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
| 物理 | 自研轻量沙箱引擎 | 速度预测 + 固定子步 + 自底向上 PBD 位置约束 + 空间哈希碰撞检测（无第三方物理依赖） |
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

每个粒子是一个有质量的小圆盘。加速度由重力与晃动惯性驱动；粒子和墙壁接触则由 PBD 位置约束单独处理：

$$\vec{a} = \vec{g}_{\text{dir}} \cdot G + \vec{a}_{\text{shake}}$$

- **求解器**：PBD 位置法（Position-Based Dynamics）：
  1. 积分速度，预测粒子位置；
  2. 多轮求解粒子重叠与位置级库仑摩擦，每轮以墙壁投影收尾；约束**自底向上**求解，让支撑从堆底逐层向上传播；
  3. 根据最终位置变化导出速度（$v = \Delta x / h$），使位置修正与速度保持同步，减少深层堆叠振铃；
- **粒子碰撞**（等质量圆）：按权重推开超出容差的重叠，恢复系数≈0（沙子不弹）；
- **位置级库仑摩擦**：每轮迭代尝试完全消除接触切向滑移，但受库仑锥限幅（$|\Delta_t| \le \mu \times$ 法向修正量，$\mu$=`FRICTION`）；驱动超过静摩擦角 $\arctan(\mu)\approx4.6°$ 时滑移消不完 → 真实滑动、重力持续加速，沙子会一直流到新的低处。静止感直接来自库仑摩擦本身（倾角小于静摩擦角 = 纹丝不动），不依赖睡眠；
- **四壁碰撞**：位置投影约束 + 快速撞墙微反弹；
- **加速结构**：空间哈希网格（cell 边长 = 粒子直径），只检测 3×3 邻域，O(n) 重建；
- **静置不抖的保障**（从求解器根治，而非用睡眠掩盖）：
  1. **PBD 位置法**——速度永远等于位置变化量，不存在“推了位置没改速度”的能量泵；
  2. **自底向上求解**——约束按深度排序、每对只从较深一方解一次，支撑从堆底逐层向上传播，深层堆叠一两轮迭代即收敛（乱序求解支撑传不下去 → 底层压穿-回弹振铃）；
  3. **小容差 + 投影收尾**——`SLOP` 远小于每子步重力下沉量，多点接触每子步即时承压，不会“蓄力-猛弹”；每轮迭代以墙壁投影收尾，导出速度不含穿墙伪影。
- **睡眠 = 纯省电优化**：粒子低速持续 `SLEEP_TIME`（2.5s）后才冻结跳过计算；醒着时的静置稳定由求解器收敛保证。每粒沙记录**入睡时的重力方向**，累计偏转超过 `WAKE_GRAVITY_DEG`（4°）即唤醒；明显晃动会唤醒全部粒子。

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
- **如何提交有效反馈？**
  请附设备型号、系统与浏览器版本、是否通过 HTTPS 访问、复现步骤和预期结果；视觉问题可附截图或短录屏。

## 8. 路线图（Roadmap）

- [ ] **iOS 适配**：`DeviceOrientationEvent.requestPermission()` + 用户手势触发授权按钮。
- [ ] **桌面鼠标模式**：新增 `src/input/mouseProvider.ts` 实现 `TiltProvider` 接口（鼠标拖动 = 晃动容器），引擎与渲染层零改动。
- [ ] **Wallpaper Engine 接入**：
  1. `npm run build`；
  2. 把 `dist/` 内全部文件与 `public/wallpaper/project.json` 拷入
     `wallpaper_engine/projects/myprojects/particle-flow/`（`project.json` 里的 `preview.png` 需自备一张预览图）；
  3. 在 WE 中选择该壁纸。注意：WE 是桌面软件、无陀螺仪，届时沙子靠鼠标"晃容器"驱动；
     `project.json` 已预留 `supportsaudioprocessing` 钩子位，未来可做音频反应。
- [ ] 可选增强：粒径分布更像真沙、配色主题切换。

## 9. 参与开发

欢迎通过 Issue 讨论 Bug、设备兼容性和功能建议。较大的代码改动请先开 Issue 对齐方案；输入层 `src/input/tilt.ts` 的 `TiltProvider` 是增加新控制方式的扩展接口。

## 10. Git 说明

- `.gitignore` 已忽略 `node_modules/`、`dist/` 等，克隆后 `npm install` 即可恢复开发环境；
- `package-lock.json` 已纳入版本管理（保证依赖可复现）；
- 建议按里程碑提交（脚手架 / 粒子渲染 / 沙箱物理 / 传感器输入 / 构建收尾各一个 commit）。
