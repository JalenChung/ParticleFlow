import type { Tilt } from '../engine/particles';

/**
 * 倾斜输入的统一接口。
 * 当前只实现了 Android 陀螺仪 + 加速度计（deviceOrientation.ts）；
 * 未来做桌面鼠标模式时新增一个 mouseProvider 实现本接口即可，
 * 引擎层与渲染层无需任何改动。
 */

export type TiltStatus =
  | 'waiting' // 已开始监听，尚未收到数据
  | 'active' // 正在接收传感器数据
  | 'unsupported' // 设备/浏览器没有该 API
  | 'no-data'; // API 存在但超时没收到数据（多为 HTTP 访问或传感器被禁用）

export interface TiltProvider {
  /** 屏幕坐标系下的重力方向（归一化，x 向右、y 向下为正），每帧读取 */
  readonly tilt: Tilt;
  /** 晃动产生的线性加速度（px/s²），由加速度计提供；无输入设备保持 (0,0) */
  readonly shake: Tilt;
  /** 当前输入状态，用于 UI 提示 */
  readonly status: TiltStatus;
  /** 状态变化回调（组件挂载后赋值） */
  onStatusChange?: (status: TiltStatus) => void;
  start(): void;
  stop(): void;
}
