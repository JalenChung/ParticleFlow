# ParticleFlow

English | [简体中文](README.zh-CN.md)

> ParticleFlow is a web-based sand simulation built with **Vue 3, TypeScript, and PixiJS**. Particles fall, collide, and form piles inside the screen; on Android, tilt or shake the phone to make the sand flow.
>
> It currently runs as a standalone web page. I plan to integrate it with **Wallpaper Engine** as an interactive wallpaper; that integration is not implemented yet.
>
> Have an idea or found a bug? Open an issue with your device/browser details and reproduction steps. For substantial changes, please open an issue first so we can discuss the approach before you start a pull request.

## Features

- **Screen-sized container:** particles stay within the screen boundaries.
- **Physical particle sizing:** each particle is approximately 3 mm in CSS physical units.
- **Adaptive particle count:** particle area totals about half the screen area (roughly 1,600 particles on a phone and 10,000 on a 1080p desktop).
- **Sand-like motion:** particles collide, stack, and slide with friction and very little bounce.
- **Android motion input:** device orientation controls gravity; linear acceleration adds shake force.

## Technology

| Area | Technology | Notes |
|---|---|---|
| Framework | Vue 3 (`<script setup>`) + TypeScript | UI and lifecycle are separate from the simulation modules. |
| Build | Vite 6 | `base: './'` supports loading the build from `file://` and Wallpaper Engine. |
| Rendering | PixiJS 8 | WebGL rendering with automatic fallback; particle sprites share a pre-rendered texture. |
| Physics | Custom TypeScript particle engine | Fixed substeps, Position-Based Dynamics (PBD), and spatial-hash collision detection. |
| Input | Android `DeviceOrientationEvent` and `DeviceMotionEvent` | Orientation controls gravity; linear acceleration drives shaking. |
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

> **Why HTTPS?** Browsers expose sensor APIs only in secure contexts such as HTTPS or localhost. Over `http://IP`, sensor data is unavailable and the simulation falls back to vertical gravity.

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

### Particle physics

Each particle is a disk. Gravity and shake input drive its acceleration; particle and wall contacts are handled separately by PBD position constraints:

$$\vec{a} = \vec{g}_{\text{dir}} \cdot G + \vec{a}_{\text{shake}}$$

- **Solver:** Position-Based Dynamics (PBD): (1) integrate velocity and predict positions, (2) iteratively resolve particle overlap and position-level Coulomb friction, projecting particles back inside the walls each iteration, and (3) derive velocity from the final position change ($v = \Delta x / h$). This keeps position and velocity in sync during contact resolution.
- **Support propagation:** constraints are solved from the bottom of the pile upward so support propagates through deep stacks.
- **Particle collisions:** equal-mass disks are separated to resolve overlap; restitution is near zero so the sand does not bounce.
- **Friction:** tangential sliding is limited by the Coulomb constraint ($|\Delta_t| \leq \mu \times$ normal correction, with `FRICTION` as $\mu$). For `FRICTION = 0.08`, the static friction angle is about $\arctan(\mu) = 4.6^\circ$.
- **Walls:** position projection keeps particles inside the screen; sufficiently fast impacts have a small bounce.
- **Broad phase:** a spatial hash with cell size equal to the particle diameter checks neighboring cells instead of every particle pair.
- **Sleep:** sleep is a power-saving optimization, not a way to hide solver jitter. A particle sleeps after remaining slow for `SLEEP_TIME` (2.5 seconds). It wakes when gravity has cumulatively changed by more than `WAKE_GRAVITY_DEG` (4 degrees) from its sleep-time baseline; a strong shake wakes all particles.

### Sensor processing

Orientation is smoothed with an EMA low-pass filter. Motion is smoothed and transformed into screen coordinates; shake force is derived from linear acceleration.

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

- At β = 90° (portrait), `gy = 1`, so gravity points down the screen. When the phone lies flat, gravity is perpendicular to the screen; when held upside down, the sand falls upward on screen.
- If no orientation data arrives within 3 seconds, the page reports that no gyroscope was detected. HTTP access or disabled sensors are common causes.
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
| `src/engine/particles.ts` | `PBD_ITER` | Position solver iterations per substep | `6` (4 above 4,000 particles) |
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
- **The phone gets hot or drains battery.** Rendering resolution is capped at 2, physics iterations scale down with particle count, and rendering pauses when the page is in the background.
- **Particles are too large or small.** Change `PARTICLE_DIAMETER_MM`. CSS millimeters are approximate; device DPI reporting may cause about ±10% variation.
- **Reporting a bug or suggesting a feature.** Include your device, OS, and browser versions, whether the page was opened over HTTPS, steps to reproduce, and what you expected to happen. A screenshot or short recording can help for visual issues.

## Roadmap

- [ ] **iOS support:** request `DeviceOrientationEvent` permission from a user gesture.
- [ ] **Desktop mouse input:** implement `TiltProvider` in `src/input/mouseProvider.ts`; dragging can simulate shaking without changing the engine or renderer.
- [ ] **Wallpaper Engine:** run `npm run build`, then copy the contents of `dist/` and `public/wallpaper/project.json` into `wallpaper_engine/projects/myprojects/particle-flow/`. Provide a `preview.png` referenced by `project.json`. Wallpaper Engine has no gyroscope, so mouse input will be needed to move the sand. The project template reserves a `supportsaudioprocessing` hook for possible audio reactivity.
- [ ] Optional improvements: vary particle sizes and add color themes.

## Contributing

Issues are welcome for bug reports, compatibility results, and feature discussion. If you plan to contribute code, open an issue first for substantial changes; focused fixes with reproduction steps are especially helpful. The input provider interface in `src/input/tilt.ts` is the intended extension point for new controls.

## Git Notes

- `.gitignore` excludes `node_modules/` and `dist/`; run `npm install` after cloning.
- `package-lock.json` is tracked for reproducible dependencies.
- Consider separate milestone commits for scaffolding, rendering, physics, sensor input, and build setup.
