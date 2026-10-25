# Milestone reports

## M1: One car on a test plane with full physics and a debug overlay ✅

**Runs:** `npm run dev`. Typecheck and production build pass. `npm run sim:headless` runs the same sim in Node.

### What was done

**Vehicle simulation** ([src/vehicles/Vehicle.ts](../src/vehicles/Vehicle.ts))
- 120 Hz fixed step with render interpolation.
- Ray-cast suspension with a bump stop and anti-roll bars.
- Pacejka combined-slip tires with load sensitivity.
- Wheel spin integrated implicitly at 960 Hz.
- Ackermann steering, speed-sensitive lock, and a countersteer allowance.
- Aero drag and downforce.
- Brake bias, handbrake, rolling resistance and surface sink drag.

**Powertrain** ([src/vehicles/Powertrain.ts](../src/vehicles/Powertrain.ts))
- Torque curve, rev limiter and engine braking.
- Clutch with launch control and full lock-up.
- Auto gearbox (throttle-scaled shift points, auto-reverse) and manual gearbox (with over-rev protection).
- Open/LSD differentials. FWD, RWD and AWD.

**Driver aids**
- ABS, proportional TC, and ESC (bicycle-model yaw reference).
- Each can be toggled live.

**Surfaces**
- Asphalt, curb, grass, gravel and wet asphalt, plus per-car surface grip multipliers.

**Car**
- Aurel Meridian GT-E (GT class), fully data-driven.

**Test pad**
- Asphalt with a 10 m grid, grass, gravel and wet strips, curbs, two ramps, a skid-pad ring and walls.
- One data definition shared by physics and rendering.

**Rendering**
- ACES tone mapping and a physical sky with IBL (sky → PMREM).
- A sun shadow that follows the car.
- Midday and sunset presets.
- Procedural car with articulated wheels (suspension, steer, spin), non-spinning calipers, and brake lights.

**Cameras and UI**
- Chase cam (heading-smoothed, speed FOV), hood cam and bumper cam.
- HUD: speed, gear, rev bar with shift light, aid indicators.
- Debug overlay (F3): per-wheel load, slip ratio and slip angle, grip used, compression, ω, drive and brake torque, surface, ABS state, plus live friction-circle plots.

**Input**
- Keyboard and standard gamepad, with bindings defined as data.

### Bench results (Meridian GT-E, `npm run sim:headless`)

| Test | Result |
|---|---|
| 0–100 km/h (TC on / off) | 3.6 s / 3.7 s |
| 0–200 km/h | 9.5 s |
| 400 m | 11.2 s |
| Top speed | 298 km/h (gear-limited at the limiter) |
| 100–0 km/h (ABS / locked) | 29.2 m / 31.5 m |
| Skid pad lateral g at 60 / 120 km/h | 1.20 / 1.17 |
| 0–100 km/h on gravel | 6.3 s |
| Settle at rest | 0.0 mm ride-height error, 0.0 mm creep |

### Bugs found and fixed during M1

- **CoM placed 0.66 m too high.** Rapier takes a collider's mass properties in *collider* space, and the car rolled over at 0.5 g. Fixed by offsetting the CoM by the collider's translation.
- **Clutch dragged the wheels backwards after the driveline overtook the engine during launch.** This caused a 1.5 s flat spot at 25 km/h. Rebuilt the clutch: it locks on speed-match, has a smooth slip band, uses a launch-specific capacity, and releases progressively.
- **Bang-bang TC bogged the engine.** Replaced with throttle reduction proportional to excess slip.

### Known issues

- **Short engine dip after launch.** At ~0.6 s the TC launch still dips briefly to ~1,400 rpm (0.55 g for ~0.2 s). This needs a launch-specific TC slip target (tuning, M3).
- **Single ray per wheel.** Sharp curb edges give a step input rather than a rolling contact. A shape-cast (cylinder sweep) is planned for M2 with the real circuit's curbs.
- **Stand-in car model.** The procedural car is an M1 stand-in. M3 adds per-class parametric bodies, clearcoat with metallic flake, liveries, and real headlight spots.
- **Shadow shimmer.** A single shadow map follows the car, so shadows shimmer slightly while moving. M2 brings cascaded shadow maps with texel snapping.
- **Large bundle.** The production bundle is 4.9 MB (1.8 MB gzipped), mostly Rapier's inlined WASM. M6 switches to the streaming (non-compat) WASM build and code-splits.
- **Harmless shader warnings.** The browser console shows `X4122` warnings from the Sky shader on Windows/ANGLE.
- **No gamepad UI actions.** Gamepads have no binding for time of day, aid toggles or the debug overlay yet (M6 rebinding).

### Next (M2)

- An original circuit (~2.5 km: long straight, fast sweepers, hairpin, chicane, elevation) in a data-driven spline format.
- Curbs, runoff, barriers, grandstands, trees.
- Checkpoints, lap and sector timing, start grid.
- Cascaded shadows, post-processing (bloom, AO, speed blur), and Low/Medium/High/Ultra presets.
- Cinematic replay camera.
