<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Application, Graphics, Sprite, type Texture, type Ticker } from 'pixi.js';
import {
  DEFAULT_HIGHLIGHT_SETTINGS,
  ParticleField,
  type BottomPulse,
} from '../engine/particles';
import { createDeviceOrientationProvider } from '../input/deviceOrientation';
import type { TiltStatus } from '../input/tilt';
import { diameterPx, particleCountFor, PARTICLE_DIAMETER_MM } from '../utils/size';

// ---- 可调参数：粒子颜色 ----
const PARTICLE_COLOR = 0x2868a8;
const HIGHLIGHT_COLOR = 0x55c8ff;
const CHARGE_PULSE_PERIOD = 2.2;
const CHARGE_PULSE_DURATION = 0.55;

const STATUS_TEXT: Record<TiltStatus, string> = {
  waiting: '正在等待陀螺仪数据…',
  active: '✓ 陀螺仪已启用',
  unsupported: '当前设备不支持陀螺仪，粒子将自动流动',
  'no-data': '未检测到陀螺仪（需 HTTPS 打开，或检查浏览器传感器权限）',
};

const hostEl = ref<HTMLDivElement | null>(null);
const status = ref<TiltStatus>('waiting');
const settingsEl = ref<HTMLDivElement | null>(null);
const settingsOpen = ref(false);
const highlightSettings = reactive({ ...DEFAULT_HIGHLIGHT_SETTINGS });

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

watch(highlightSettings, (settings) => {
  field?.setHighlightSettings(settings);
});

function onDocumentPointerDown(event: PointerEvent): void {
  if (!settingsEl.value?.contains(event.target as Node)) settingsOpen.value = false;
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') settingsOpen.value = false;
}

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
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);
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
  field.setHighlightSettings(highlightSettings);
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
        const progress = phase / CHARGE_PULSE_DURATION;
        const strength = Math.sin(progress * Math.PI);
        bottomPulse = {
          x: 0,
          y: 0,
          originX: host.clientWidth / 2,
          originY: host.clientHeight,
          waveRadius: host.clientHeight * 0.5 * progress,
          waveWidth: Math.max(50, host.clientHeight * 0.065),
          strength: 4500 * strength,
        };
      }
    }
    field.update(dt, provider.tilt, provider.shake, bottomPulse);
    const list = field.particles;
    for (let i = 0; i < sprites.length; i++) {
      sprites[i].position.set(list[i].x, list[i].y);
      const intensity =
        list[i].highlightStrength *
        Math.min(1, list[i].highlight / Math.max(0.01, highlightSettings.fadeDuration));
      sprites[i].tint = mixColor(PARTICLE_COLOR, HIGHLIGHT_COLOR, intensity);
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
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeyDown);
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

function mixColor(from: number, to: number, amount: number): number {
  const red = Math.round(((from >> 16) & 0xff) * (1 - amount) + ((to >> 16) & 0xff) * amount);
  const green = Math.round(((from >> 8) & 0xff) * (1 - amount) + ((to >> 8) & 0xff) * amount);
  const blue = Math.round((from & 0xff) * (1 - amount) + (to & 0xff) * amount);
  return (red << 16) | (green << 8) | blue;
}
</script>

<template>
  <div class="scene">
    <div ref="hostEl" class="particle-host"></div>
    <div ref="settingsEl" class="settings">
      <button
        class="settings-toggle"
        type="button"
        aria-label="打开设置"
        :aria-expanded="settingsOpen"
        @click="settingsOpen = !settingsOpen"
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <Transition name="menu">
        <section v-if="settingsOpen" class="settings-panel" aria-label="粒子设置">
          <header class="settings-header">
            <h2>粒子设置</h2>
            <button
              class="reset-button"
              type="button"
              @click="Object.assign(highlightSettings, DEFAULT_HIGHLIGHT_SETTINGS)"
            >
              恢复默认
            </button>
          </header>
          <label class="toggle-row">
            <span>开启高亮防抖</span>
            <input v-model="highlightSettings.debounceEnabled" type="checkbox" />
          </label>
          <label class="setting-row" :class="{ disabled: !highlightSettings.debounceEnabled }">
            <span class="setting-label">
              <span>防抖时间</span>
              <output>{{ highlightSettings.cooldownDuration.toFixed(2) }} 秒</output>
            </span>
            <input
              v-model.number="highlightSettings.cooldownDuration"
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              :disabled="!highlightSettings.debounceEnabled"
            />
          </label>
          <label class="setting-row">
            <span class="setting-label">
              <span>高亮消退时间</span>
              <output>{{ highlightSettings.fadeDuration.toFixed(2) }} 秒</output>
            </span>
            <input
              v-model.number="highlightSettings.fadeDuration"
              type="range"
              min="0.1"
              max="2"
              step="0.05"
            />
          </label>
          <label class="setting-row">
            <span class="setting-label">
              <span>高亮触发阈值</span>
              <output>{{ highlightSettings.minimumForce }}</output>
            </span>
            <input
              v-model.number="highlightSettings.minimumForce"
              type="range"
              min="500"
              max="8000"
              step="100"
            />
          </label>
        </section>
      </Transition>
    </div>
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

.settings {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  z-index: 2;
  color: #e7f2ff;
  font-family: inherit;
}

.settings-toggle,
.reset-button {
  color: inherit;
  border: 1px solid rgba(154, 220, 255, 0.28);
  background: rgba(12, 22, 42, 0.78);
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.settings-toggle {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 12px;
  font-size: 21px;
}

.settings-toggle:hover,
.reset-button:hover {
  background: rgba(35, 63, 91, 0.92);
}

.settings-toggle:focus-visible,
.reset-button:focus-visible,
.settings-panel input:focus-visible {
  outline: 2px solid #70d7ff;
  outline-offset: 3px;
}

.settings-panel {
  position: absolute;
  top: 54px;
  right: 0;
  width: min(300px, calc(100vw - 28px));
  padding: 16px;
  border: 1px solid rgba(154, 220, 255, 0.24);
  border-radius: 12px;
  background: rgba(10, 19, 34, 0.94);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
}

.settings-header,
.toggle-row,
.setting-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-header {
  margin-bottom: 14px;
}

.settings-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.reset-button {
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 12px;
}

.toggle-row,
.setting-row {
  display: block;
  padding: 11px 0;
  border-top: 1px solid rgba(154, 220, 255, 0.12);
  font-size: 13px;
}

.toggle-row {
  display: flex;
}

.toggle-row input {
  width: 18px;
  height: 18px;
  accent-color: #55c8ff;
}

.setting-label {
  gap: 12px;
  margin-bottom: 10px;
}

.setting-label output {
  color: #9dc6e4;
  font-variant-numeric: tabular-nums;
}

.setting-row input[type='range'] {
  display: block;
  width: 100%;
  height: 20px;
  margin: 0;
  accent-color: #55c8ff;
}

.setting-row.disabled {
  color: #8495a8;
}

.setting-row input:disabled {
  opacity: 0.45;
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

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
  transform-origin: top right;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
}
</style>
