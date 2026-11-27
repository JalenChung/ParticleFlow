/** 屏幕坐标系向量（x 向右、y 向下为正） */
export interface Tilt {
  x: number;
  y: number;
}

export interface BottomPulse extends Tilt {
  /** 脉冲源在屏幕坐标中的横向中心位置（px） */
  originX: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 本子步约束求解前的预测位置（速度由位置变化量导出用） */
  ox: number;
  oy: number;
  /** 静止累计时间（秒）：连续低速累积到 SLEEP_TIME 即休眠冻结 */
  sleep: number;
  /** 沉睡朝向基准（入睡瞬间的归一化重力方向）：(0,0) = 平放入睡（方向无意义） */
  sgx: number;
  sgy: number;
}

// ---- 物理参数（调手感改这里）----
/** 重力加速度（px/s²） */
const GRAVITY = 2200;
/** 快速撞墙的微反弹系数（沙子几乎不弹） */
const WALL_E = 0.2;
/** 空气阻尼（1/s），防止速度无限累积 */
const AIR_DAMP = 0.5;
/** 最大速度（px/s），防止数值爆炸 */
const MAX_SPEED = 2600;
/** 每帧物理子步数 */
const SUBSTEPS = 2;
/** 每子步位置约束迭代次数（堆叠深度大时力传导更充分） */
const PBD_ITER = 6;
const PBD_ITER_LOW = 4;
/** 粒子多时降档迭代保帧率 */
const PBD_ITER_THRESHOLD = 4000;

// ---- 堆叠稳定性参数 ----
/**
 * 位置容差（px）：重叠量小于此视为正常接触、不校正。
 * 取值须远小于每子步重力下沉量（g·h²≈0.15px），否则多点接触会“蓄力-猛弹”；
 * 留一点容差只为避免完美贴合时的数值噪声。
 */
const SLOP = 0.05;
/**
 * 库仑摩擦系数 μ（0~1）：切向修正限幅 = μ × 本轮法向修正（∝接触压力）。
 * 静摩擦角 ≈ atan(μ) ≈ 4.6°——倾角小于它沙堆静止，大于它沙子真实滑动加速流动。
 * 调大 → 沙堆更陡、更"稠"；调小 → 更"滑"。
 */
const FRICTION = 0.08;

// ---- 睡眠 / 唤醒参数 ----
/** 休眠速度阈值（px/s）：低于此速度累积静止时间 */
const REST_SPEED = 15;
/**
 * 休眠时间（秒）：静止持续这么久才冻结（速度清零、跳过计算）。
 * 睡眠只是长时间静置的省电/性能优化，绝不用于防抖——
 * 粒子醒着时的静置稳定由求解器收敛保证。
 */
const SLEEP_TIME = 2.5;
/** 唤醒邻居的重叠量（px）：被压得太深说明该醒了（须大于稳态重叠余量） */
const WAKE_OVERLAP = 1.0;
/** 唤醒邻居的撞击速度（px/s） */
const WAKE_SPEED = 60;
/** 朝向偏转超过该角度（度）即唤醒——略小于静摩擦角 atan(μ)≈4.6°，只要物理上能滑就唤醒 */
const WAKE_GRAVITY_DEG = 4;
/** 面内重力最小有效值（≈倾角 4.6°）：太小说明手机近乎平放，方向无意义 */
const G_MIN_LEN = 0.08;
/** 明显晃动（px/s²，≈1.5 m/s²）唤醒全部粒子——须刻意晃动，日常手持摆动不唤醒 */
const WAKE_SHAKE = 350;
/** 撞墙反弹的最小入墙速度（px/s），慢速触墙不弹 */
const BOUNCE_MIN_SPEED = 40;

const WAKE_DOT = Math.cos((WAKE_GRAVITY_DEG * Math.PI) / 180);

/**
 * 沙箱粒子仿真——屏幕是一个"容器"，粒子就是一把沙子：
 * 受重力下落、粒子之间互相碰撞、与四壁碰撞。
 *
 * 求解器：PBD（Position-Based Dynamics）位置法，影视/游戏沙粒模拟的标准做法：
 * 1. 速度积分 → 预测位置；
 * 2. 多轮位置约束迭代（重叠推开 + 墙壁投影 + 位置级切向摩擦）；
 * 3. **速度由位置变化量导出**（v = Δx/h）——位置与速度天然同步，
 *    根除"推了位置没改速度"造成的深层堆叠高频振铃。
 *
 * 空间哈希网格（cell = 粒子直径）做宽相碰撞检测，约束自底向上求解（支撑逐层向上传播、
 * 深层堆叠快速收敛——静置不抖的根本）；睡眠仅是长时间静置后的省电优化。
 * 纯 TypeScript，与渲染完全解耦。
 */
export class ParticleField {
  readonly particles: Particle[] = [];
  private width: number;
  private height: number;
  private diameter: number;

  // 本帧归一化重力方向 + 有效性（面内分量太小时方向无意义）
  private curGx = 0;
  private curGy = 1;
  private gValid = false;

  // 空间哈希网格（每次碰撞迭代前重建）+ 每粒子格子快照（求解次序/去重用）
  private cols = 1;
  private rows = 1;
  private heads = new Int32Array(0);
  private next = new Int32Array(0);
  private pcx = new Int32Array(0);
  private pcy = new Int32Array(0);

  constructor(width: number, height: number, count: number, diameter: number) {
    this.width = width;
    this.height = height;
    this.diameter = diameter;
    this.setCount(count);
  }

  /** 调整粒子数量（窗口尺寸变化时调用） */
  setCount(count: number): void {
    const n = Math.max(1, Math.floor(count));
    while (this.particles.length < n) this.particles.push(this.spawn());
    if (this.particles.length > n) this.particles.length = n;
  }

  /** 屏幕尺寸变化：更新边界、碰撞粒径并同步数量 */
  resize(width: number, height: number, count: number, diameter: number): void {
    this.width = width;
    this.height = height;
    this.diameter = diameter;
    this.setCount(count);
    for (const p of this.particles) {
      p.x = Math.min(Math.max(p.x, 0), width);
      p.y = Math.min(Math.max(p.y, 0), height);
      p.ox = p.x;
      p.oy = p.y;
    }
  }

  /**
   * 推进一帧仿真（dt 单位：秒）。
   * @param gravity 重力方向（归一化，由陀螺仪倾斜决定；无输入时 (0,1) 即竖直向下）
   * @param shake   晃动产生的线性加速度（px/s²），由加速度计提供，可省略
   * @param bottomPulse 底部脉冲；originX 为脉冲在底部中间的出发点
   */
  update(dt: number, gravity: Tilt, shake?: Tilt, bottomPulse?: BottomPulse): void {
    // 明显晃动 → 唤醒全部
    const shaken =
      shake !== undefined &&
      shake.x * shake.x + shake.y * shake.y > WAKE_SHAKE * WAKE_SHAKE;
    if (shaken) this.wakeAll();

    // 充电脉冲只唤醒底部中间区域。
    if (bottomPulse && Math.hypot(bottomPulse.x, bottomPulse.y) > 1) {
      const verticalZone = Math.max(this.height * 0.22, this.diameter);
      const pulseTop = this.height - verticalZone;
      const horizontalRadius = Math.max(this.width * 0.22, this.diameter);
      for (const p of this.particles) {
        const dx = p.x - bottomPulse.originX;
        const vertical = Math.max(0, Math.min(1, (p.y - pulseTop) / verticalZone));
        const horizontal = Math.max(0, 1 - Math.abs(dx) / horizontalRadius);
        if (vertical * horizontal <= 0) continue;
        if (p.sleep >= SLEEP_TIME) {
          p.ox = p.x;
          p.oy = p.y;
        }
        p.sleep = 0;
      }
    }

    // 累计偏转唤醒：逐粒子对比“入睡时的重力方向”（非逐帧差分！），
    // 无论多慢的旋转/翻转，累计偏转一超过阈值就当帧唤醒——零等待。
    // 基准在入睡瞬间更新 → 同一姿态不会反复唤醒（自带迟滞，天然抗噪声）。
    const len = Math.hypot(gravity.x, gravity.y);
    this.gValid = len > G_MIN_LEN;
    if (this.gValid) {
      this.curGx = gravity.x / len;
      this.curGy = gravity.y / len;
      for (const p of this.particles) {
        if (p.sleep < SLEEP_TIME) continue;
        // 基准为零向量 = 平放入睡（方向无意义），任何倾斜都唤醒
        const settled =
          p.sgx !== 0 || p.sgy !== 0
            ? this.curGx * p.sgx + this.curGy * p.sgy >= WAKE_DOT
            : false;
        if (!settled) {
          p.sleep = 0;
          p.ox = p.x;
          p.oy = p.y;
        }
      }
    }

    const iters =
      this.particles.length > PBD_ITER_THRESHOLD ? PBD_ITER_LOW : PBD_ITER;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.step(h, gravity, shake, bottomPulse, iters);
  }

  private step(
    dt: number,
    gravity: Tilt,
    shake: Tilt | undefined,
    bottomPulse: BottomPulse | undefined,
    iters: number,
  ): void {
    const verticalZone = Math.max(this.height * 0.22, this.diameter);
    const pulseTop = this.height - verticalZone;
    const horizontalRadius = Math.max(this.width * 0.22, this.diameter);

    // 1) 预测：积分速度 → 记录起点 → 推进位置
    const damp = Math.exp(-AIR_DAMP * dt);
    const max2 = MAX_SPEED * MAX_SPEED;
    for (const p of this.particles) {
      if (p.sleep >= SLEEP_TIME) continue;
      const vertical = bottomPulse
        ? Math.max(0, Math.min(1, (p.y - pulseTop) / verticalZone))
        : 0;
      const horizontal = bottomPulse
        ? Math.max(0, 1 - Math.abs(p.x - bottomPulse.originX) / horizontalRadius)
        : 0;
      const influence = vertical * horizontal;
      const gx = gravity.x * GRAVITY + (shake?.x ?? 0) + (bottomPulse?.x ?? 0) * influence;
      const gy = gravity.y * GRAVITY + (shake?.y ?? 0) + (bottomPulse?.y ?? 0) * influence;
      p.vx = (p.vx + gx * dt) * damp;
      p.vy = (p.vy + gy * dt) * damp;
      const sp2 = p.vx * p.vx + p.vy * p.vy;
      if (sp2 > max2) {
        const s = MAX_SPEED / Math.sqrt(sp2);
        p.vx *= s;
        p.vy *= s;
      }
      p.ox = p.x;
      p.oy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // 2) 位置约束迭代：重叠推开 + 位置级摩擦，每轮以墙壁投影收尾
    //    （收尾投影保证结果无穿墙 → 导出速度不含穿墙伪影 → 墙边不抖）
    for (let k = 0; k < iters; k++) {
      this.buildGrid();
      this.solvePairs();
      this.solveWalls();
    }

    // 3) 速度由位置变化量导出（位置/速度同步的关键）+ 睡眠判定
    const rest2 = REST_SPEED * REST_SPEED;
    const r = this.diameter / 2;
    const maxX = this.width - r;
    const maxY = this.height - r;
    for (const p of this.particles) {
      if (p.sleep >= SLEEP_TIME) continue;
      const preVx = p.vx;
      const preVy = p.vy;
      let nvx = (p.x - p.ox) / dt;
      let nvy = (p.y - p.oy) / dt;

      // 快速撞墙微反弹（慢速触墙不弹）
      if (p.x <= r + 0.01 && preVx < -BOUNCE_MIN_SPEED)
        nvx = Math.max(nvx, -preVx * WALL_E);
      else if (p.x >= maxX - 0.01 && preVx > BOUNCE_MIN_SPEED)
        nvx = Math.min(nvx, -preVx * WALL_E);
      if (p.y <= r + 0.01 && preVy < -BOUNCE_MIN_SPEED)
        nvy = Math.max(nvy, -preVy * WALL_E);
      else if (p.y >= maxY - 0.01 && preVy > BOUNCE_MIN_SPEED)
        nvy = Math.min(nvy, -preVy * WALL_E);

      // 位置导出速度限幅（防约束修正产生的数值毛刺）
      let sp2 = nvx * nvx + nvy * nvy;
      if (sp2 > max2) {
        const s = MAX_SPEED / Math.sqrt(sp2);
        nvx *= s;
        nvy *= s;
        sp2 = max2;
      }

      p.vx = nvx;
      p.vy = nvy;

      if (sp2 < rest2) {
        p.sleep += dt;
        // 静止过程中实时跟随重力方向，入睡瞬间定格为“沉睡朝向基准”；
        // 平放入睡记零向量（方向无意义），之后任何倾斜都会唤醒
        if (p.sleep < SLEEP_TIME) {
          p.sgx = this.gValid ? this.curGx : 0;
          p.sgy = this.gValid ? this.curGy : 0;
        }
        if (p.sleep >= SLEEP_TIME) {
          p.vx = 0;
          p.vy = 0;
        }
      } else {
        p.sleep = 0;
      }
    }
  }

  /** 墙壁位置投影：把粒子约束进容器（PBD 的"硬约束"） */
  private solveWalls(): void {
    const r = this.diameter / 2;
    const maxX = this.width - r;
    const maxY = this.height - r;
    for (const p of this.particles) {
      if (p.sleep >= SLEEP_TIME) continue;
      if (p.x < r) p.x = r;
      else if (p.x > maxX) p.x = maxX;
      if (p.y < r) p.y = r;
      else if (p.y > maxY) p.y = maxY;
    }
  }

  /** 重建空间哈希网格：O(n)，cell 边长 = 粒子直径 */
  private buildGrid(): void {
    const cell = Math.max(this.diameter, 1);
    this.cols = Math.max(1, Math.ceil(this.width / cell));
    this.rows = Math.max(1, Math.ceil(this.height / cell));
    const nCells = this.cols * this.rows;
    if (this.heads.length < nCells) this.heads = new Int32Array(nCells);
    this.heads.fill(-1, 0, nCells);
    const n = this.particles.length;
    if (this.next.length < n) {
      this.next = new Int32Array(n);
      this.pcx = new Int32Array(n);
      this.pcy = new Int32Array(n);
    }

    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      let cx = Math.floor(p.x / cell);
      let cy = Math.floor(p.y / cell);
      if (cx < 0) cx = 0;
      else if (cx >= this.cols) cx = this.cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= this.rows) cy = this.rows - 1;
      const c = cy * this.cols + cx;
      this.pcx[i] = cx;
      this.pcy[i] = cy;
      this.next[i] = this.heads[c];
      this.heads[c] = i;
    }
  }

  /**
   * 宽相 → 窄相：3×3 邻域粒子对做位置约束。
   * 按格子自底向上（深→浅）遍历、每对只从较深一方解一次：
   * 高斯-赛德尔于是自堆底把支撑逐层向上传播，深层堆叠一两轮迭代即收敛。
   * 乱序求解支撑传不下去 → 底层被压穿-回弹振铃（深层抖动的真正根源）。
   */
  private solvePairs(): void {
    for (let cy = this.rows - 1; cy >= 0; cy--) {
      for (let cx = 0; cx < this.cols; cx++) {
        let i = this.heads[cy * this.cols + cx];
        while (i !== -1) {
          for (let oy = -1; oy <= 1; oy++) {
            const gy = cy + oy;
            if (gy < 0 || gy >= this.rows) continue;
            for (let ox = -1; ox <= 1; ox++) {
              const gx = cx + ox;
              if (gx < 0 || gx >= this.cols) continue;
              let j = this.heads[gy * this.cols + gx];
              while (j !== -1) {
                if (this.pairFirst(i, j)) this.solvePair(i, j);
                j = this.next[j];
              }
            }
          }
          i = this.next[i];
        }
      }
    }
  }

  /** 每对只解一次，且由“较深一方”发起（保证自底向上的求解次序） */
  private pairFirst(i: number, j: number): boolean {
    if (i === j) return false;
    const yi = this.pcy[i];
    const yj = this.pcy[j];
    if (yi !== yj) return yi > yj;
    const xi = this.pcx[i];
    const xj = this.pcx[j];
    if (xi !== xj) return xi > xj;
    return i < j;
  }

  /**
   * 圆-圆位置约束：
   * - 重叠分离：按权重推开超出容差的重叠（休眠者视作“地面”，只推醒着的一方）；
   * - 位置级库仑摩擦：消除接触切向滑移，限幅 ±μ×法向修正（库仑锥）。
   */
  private solvePair(i: number, j: number): void {
    const ps = this.particles;
    const pi = ps[i];
    const pj = ps[j];
    const dx = pj.x - pi.x;
    const dy = pj.y - pi.y;
    const d2 = dx * dx + dy * dy;
    const D = this.diameter;
    if (d2 >= D * D || d2 === 0) return;

    const asleepI = pi.sleep >= SLEEP_TIME;
    const asleepJ = pj.sleep >= SLEEP_TIME;
    if (asleepI && asleepJ) return;

    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const overlap = D - d;

    // 休眠粒子视作"地面"：轻微接触不唤醒（保持静置稳定），压得太深/被快撞才唤醒
    if (asleepI || asleepJ) {
      const rvx = pj.vx - pi.vx;
      const rvy = pj.vy - pi.vy;
      const approach = -(rvx * nx + rvy * ny); // > 0 = 相互接近
      if (overlap < WAKE_OVERLAP && approach < WAKE_SPEED) {
        // 静态求解：只推醒着的一方（睡眠方是"地面"，不动）
        this.applyCorr(pi, pj, nx, ny, overlap, asleepI ? 0 : 1, asleepJ ? 0 : 1);
        return;
      }
      // 唤醒：位置/起点对齐，避免速度导出用到陈旧数据
      if (asleepI) {
        pi.sleep = 0;
        pi.ox = pi.x;
        pi.oy = pi.y;
      }
      if (asleepJ) {
        pj.sleep = 0;
        pj.ox = pj.x;
        pj.oy = pj.y;
      }
    }

    this.applyCorr(pi, pj, nx, ny, overlap, 1, 1);
  }

  /** 应用位置分离 + 切向摩擦（wi/wj = 各方可移动权重，休眠方为 0） */
  private applyCorr(
    pi: Particle,
    pj: Particle,
    nx: number,
    ny: number,
    overlap: number,
    wi: number,
    wj: number,
  ): void {
    const wSum = wi + wj;
    if (wSum === 0) return;

    // 位置分离：推开超出容差的重叠
    const corr = Math.min(Math.max(overlap - SLOP, 0), this.diameter * 0.5);
    const ci = (corr * wi) / wSum;
    const cj = (corr * wj) / wSum;
    pi.x -= nx * ci;
    pi.y -= ny * ci;
    pj.x += nx * cj;
    pj.y += ny * cj;

    // 位置级库仑摩擦：尝试完全消除本子步累积的切向滑移（corrT = dispT → dispT_new = 0），
    // 但受库仑锥限制 |corrT| ≤ μ × 本轮法向修正（法向修正 ∝ 接触压力）。
    // 驱动超过 μ×法向压力时滑移消不完 → 真实滑动、重力持续加速（沙子流动）。
    const tx = -ny;
    const ty = nx;
    const dtx = pj.x - pj.ox - (pi.x - pi.ox);
    const dty = pj.y - pj.oy - (pi.y - pi.oy);
    const dispT = dtx * tx + dty * ty;
    const maxT = FRICTION * corr;
    let corrT = dispT;
    if (corrT > maxT) corrT = maxT;
    else if (corrT < -maxT) corrT = -maxT;
    const ti = (corrT * wi) / wSum;
    const tj = (corrT * wj) / wSum;
    pi.x += tx * ti;
    pi.y += ty * ti;
    pj.x -= tx * tj;
    pj.y -= ty * tj;
  }

  /** 唤醒所有粒子（明显晃动时） */
  private wakeAll(): void {
    for (const p of this.particles) {
      if (p.sleep >= SLEEP_TIME) {
        p.ox = p.x;
        p.oy = p.y;
      }
      p.sleep = 0;
    }
  }

  private spawn(): Particle {
    const x = Math.random() * this.width;
    const y = Math.random() * this.height;
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      ox: x,
      oy: y,
      sleep: 0,
      sgx: 0,
      sgy: 0,
    };
  }
}
