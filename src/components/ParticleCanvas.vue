<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Application, Graphics, Sprite, type Texture, type Ticker } from 'pixi.js';
import { ParticleField, type BottomPulse } from '../engine/particles';
import { createDeviceOrientationProvider } from '../input/deviceOrientation';
import type { TiltStatus } from '../input/tilt';
import { diameterPx, particleCountFor, PARTICLE_DIAMETER_MM } from '../utils/size';

// ---- 可调参数：粒子颜色 ----
const PARTICLE_COLOR = 0x9adcff;
const CHARGE_PULSE_PERIOD = 1.4;
const CHARGE_PULSE_DURATION = 0.38;

const STATUS_TEXT: Record<TiltStatus, string> = {
  waiting: '正在等待陀螺仪数据…',
  active: '✓ 陀螺仪已启用',
  unsupported: '当前设备不支持陀螺仪，粒子将自动流动',
  'no-data': '未检测到陀螺仪（需 HTTPS 打开，或检查浏览器传感器权限）',
};

const hostEl = ref<HTMLDivElement | null>(null);
const status = ref<TiltStatus>('waiting');

const provider = createDeviceOrientationProvider();

let app: Application | null = null;
let field: ParticleField | null = null;
let texture: Texture | null = null;
let sprites: Sprite[] = [];
let observer: ResizeObserver | null = null;
let resizeTimer: number | undefined;
let batteryManager: (EventTarget & { charging: boolean }) | null = null;
let charging = false;
let chargeElapsed = 0;
let disposed = false;

/** 根据粒子数量同步精灵池（增/删 Sprite） */
function rebuildSprites(): void {
  if (!app || !field || !texture) return;
  const d = diameterPx(PARTICLE_DIAMETER_MM);
  const stage = app.stage;

  while (sprites.length > field.particles.length) {
    const s = sprites.pop()!;
    stage.removeChild(s);
    s.destroy();
  }
  while (sprites.length < field.particles.length) {
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.width = d;
    s.height = d;
    s.tint = PARTICLE_COLOR;
    stage.addChild(s);
    sprites.push(s);
  }
}

function onVisibility(): void {
  if (!app) return;
  // 页面切后台暂停渲染，省电省 GPU
  if (document.hidden) app.ticker.stop();
  else app.ticker.start();
}

onMounted(async () => {
  const host = hostEl.value!;

  const dpr = Math.min(window.devicePixelRatio || 1, 2); // 分辨率上限 2，控移动端发热
  const pixi = new Application();
  await pixi.init({
    backgroundAlpha: 0,
    resizeTo: host,
    antialias: true,
    resolution: dpr,
    autoDensity: true,
  });
  app = pixi;
  host.appendChild(pixi.canvas);

  // 圆点纹理：预渲染一张白色圆形 sprite，靠 tint 上色，避免每帧重绘图形
  texture = pixi.renderer.generateTexture({
    target: new Graphics().circle(0, 0, 24).fill(0xffffff),
    resolution: dpr,
  });

  const w = host.clientWidth;
  const h = host.clientHeight;
  field = new ParticleField(w, h, particleCountFor(w, h), diameterPx(PARTICLE_DIAMETER_MM));
  rebuildSprites();

  // 输入：Android 陀螺仪
  provider.onStatusChange = (s) => (status.value = s);
  provider.start();

  // Battery Status API is optional and unavailable in some browsers.
  const getBattery = (
    navigator as Navigator & {
      getBattery?: () => Promise<EventTarget & { charging: boolean }>;
    }
  ).getBattery;
  if (typeof getBattery === 'function') {
    void getBattery.call(navigator).then((battery) => {
      if (disposed) return;
      batteryManager = battery;
      charging = battery.charging;
      battery.addEventListener('chargingchange', onChargingChange);
    }).catch(() => {});
  }

  // 主循环
  pixi.ticker.add((ticker: Ticker) => {
    if (!field) return;
    const dt = Math.min(ticker.deltaMS, 66) / 1000; // 掉帧时防止一次跳太远
    let bottomPulse: BottomPulse | undefined;
    if (charging) {
      chargeElapsed += dt;
      const phase = (chargeElapsed % CHARGE_PULSE_PERIOD) / CHARGE_PULSE_PERIOD;
      if (phase < CHARGE_PULSE_DURATION) {
        const strength = Math.sin((phase / CHARGE_PULSE_DURATION) * Math.PI);
        bottomPulse = {
          x: 0,
          y: -4500 * strength,
          originX: host.clientWidth / 2,
        };
      }
    }
    field.update(dt, provider.tilt, provider.shake, bottomPulse);
    const list = field.particles;
    for (let i = 0; i < sprites.length; i++) {
      sprites[i].position.set(list[i].x, list[i].y);
    }
  });

  // 窗口尺寸变化 → 重算粒子数量（半屏覆盖公式）与边界
  observer = new ResizeObserver(() => {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const el = hostEl.value;
      if (!app || !field || !el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw === 0 || ch === 0) return;
      field.resize(cw, ch, particleCountFor(cw, ch), diameterPx(PARTICLE_DIAMETER_MM));
      rebuildSprites();
    }, 250);
  });
  observer.observe(host);

  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  disposed = true;
  provider.stop();
  provider.onStatusChange = undefined;
  batteryManager?.removeEventListener('chargingchange', onChargingChange);
  batteryManager = null;
  observer?.disconnect();
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  document.removeEventListener('visibilitychange', onVisibility);
  if (app) {
    app.destroy({ removeView: true }, { children: true });
    app = null;
    field = null;
    texture = null;
    sprites = [];
  }
});

function onChargingChange(): void {
  if (batteryManager) charging = batteryManager.charging;
}
</script>

<template>
  <div class="scene">
    <div ref="hostEl" class="particle-host"></div>
    <Transition name="fade">
      <div v-if="status !== 'active'" class="status-pill">{{ STATUS_TEXT[status] }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.scene {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.particle-host {
  width: 100%;
  height: 100%;
}

.status-pill {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  max-width: 86vw;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(12, 22, 42, 0.72);
  border: 1px solid rgba(154, 220, 255, 0.25);
  color: #cfe8ff;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  backdrop-filter: blur(6px);
  pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.6s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
