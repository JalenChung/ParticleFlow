import type { Tilt } from '../engine/particles';
import type { TiltProvider, TiltStatus } from './tilt';

// ---- 可调参数 ----
/** 重力横向方向：觉得流动方向反了改 -1 */
const TILT_SIGN_X = 1;
/** 重力纵向方向：觉得流动方向反了改 -1 */
const TILT_SIGN_Y = 1;
/** 晃动增益：线性加速度 m/s² → px/s²（约等于 重力加速度/9.8） */
const SHAKE_GAIN = 225;
/** 晃动平滑系数（越小越迟钝，抗手抖） */
const SHAKE_SMOOTH = 0.2;
/** 姿态角 EMA 平滑系数（越小越平滑、跟随越迟钝） */
const SMOOTH_ALPHA = 0.15;
/** 超过该时间没收到任何方向数据 → 判定为不可用 */
const NO_DATA_TIMEOUT_MS = 3000;

const DEG = Math.PI / 180;

/**
 * Android 传感器输入（陀螺仪 + 加速度计）。
 *
 * 1) 重力方向：由姿态角直接推导——物理精确，无需零点基准：
 *      gx = cos(β) · sin(γ)
 *      gy = sin(β)
 *    β=90°（竖屏直立）时 gy=1，重力直指屏幕下方；
 *    平放时重力垂直屏幕、不产生屏幕内流动；倒持时沙子往"上"落。
 *
 * 2) 晃动：来自 devicemotion 的线性加速度（不含重力），
 *    作为惯性力 -a 作用在沙子上（手机一甩，沙子跟着飞）。
 *
 * 注意：传感器 API 只在 HTTPS（安全上下文）下可用；
 * Android 无需 iOS 式的 requestPermission 弹窗。
 */
export function createDeviceOrientationProvider(): TiltProvider {
  // 无传感器时默认竖直向下：沙子自然堆在容器底部
  const tilt: Tilt = { x: 0, y: 1 };
  const shake: Tilt = { x: 0, y: 0 };
  let status: TiltStatus = 'waiting';
  let timer: number | undefined;
  let started = false;

  let smBeta = 0;
  let smGamma = 0;
  let initialized = false;

  const provider: TiltProvider = {
    tilt,
    shake,
    get status() {
      return status;
    },
    onStatusChange: undefined,

    start() {
      if (started) return;
      started = true;

      const hasOrient = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
      const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
      if (!hasOrient && !hasMotion) {
        setStatus('unsupported');
        return;
      }

      if (hasOrient) window.addEventListener('deviceorientation', onOrientation);
      if (hasMotion) window.addEventListener('devicemotion', onMotion);
      timer = window.setTimeout(() => {
        if (status === 'waiting') setStatus('no-data');
      }, NO_DATA_TIMEOUT_MS);
    },

    stop() {
      if (!started) return;
      started = false;
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      tilt.x = 0;
      tilt.y = 1;
      shake.x = 0;
      shake.y = 0;
    },
  };

  function setStatus(s: TiltStatus): void {
    if (s === status) return;
    status = s;
    provider.onStatusChange?.(s);
  }

  /** 姿态角 → 屏幕坐标系重力方向 */
  function onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta == null || e.gamma == null) return;
    setStatus('active');

    if (!initialized) {
      smBeta = e.beta;
      smGamma = e.gamma;
      initialized = true;
    }
    smBeta += (e.beta - smBeta) * SMOOTH_ALPHA;
    smGamma += (e.gamma - smGamma) * SMOOTH_ALPHA;

    const b = smBeta * DEG;
    const g = smGamma * DEG;
    tilt.x = TILT_SIGN_X * Math.cos(b) * Math.sin(g);
    tilt.y = TILT_SIGN_Y * Math.sin(b);
  }

  /** 线性加速度 → 晃动惯性力（-a），设备坐标 y 向上 → 屏幕 y 向下 */
  function onMotion(e: DeviceMotionEvent): void {
    const a = e.acceleration; // 不含重力的线性加速度
    if (a?.x == null || a.y == null) return;
    const tx = -a.x * SHAKE_GAIN;
    const ty = a.y * SHAKE_GAIN;
    shake.x += (tx - shake.x) * SHAKE_SMOOTH;
    shake.y += (ty - shake.y) * SHAKE_SMOOTH;
  }

  return provider;
}
