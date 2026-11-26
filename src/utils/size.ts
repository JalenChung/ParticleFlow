/**
 * 物理尺寸与粒子数量换算工具。
 *
 * CSS 标准规定 1in = 96px，因此 1mm = 96/25.4 ≈ 3.7795px。
 * 浏览器没有直接读取屏幕真实 DPI 的 API，用 CSS 的 mm 单位换算
 * 是移动端能做到的最接近物理尺寸的方式（手机上误差很小）。
 */

export const MM_TO_PX = 96 / 25.4;

/** 粒子的物理直径（毫米）——需求：约 3mm */
export const PARTICLE_DIAMETER_MM = 3;

/** 粒子总面积占屏幕面积的比例——需求：约占屏幕一半 */
export const COVERAGE = 0.5;

/** 直径（mm）→ CSS 像素 */
export function diameterPx(mm: number = PARTICLE_DIAMETER_MM): number {
  return mm * MM_TO_PX;
}

/**
 * 根据屏幕尺寸计算粒子数量。
 * N = 覆盖率 × 屏幕面积 / 单粒面积
 * 例：手机 393×851 ≈ 1600 个；桌面 1080p ≈ 10000 个。
 */
export function particleCountFor(
  widthPx: number,
  heightPx: number,
  diameterMm: number = PARTICLE_DIAMETER_MM,
  coverage: number = COVERAGE,
): number {
  const r = diameterPx(diameterMm) / 2;
  const single = Math.PI * r * r;
  return Math.max(1, Math.round((widthPx * heightPx * coverage) / single));
}
