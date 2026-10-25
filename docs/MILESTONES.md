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

---

## M2: Circuit, lap timing, cameras, graphics pipeline ✅

**Runs:** `npm run dev` opens the circuit. `npm test` passes (typecheck, bench, track build, 2-lap autopilot). `npm run build` passes.

### What was done

**Track format** ([src/tracks/types.ts](../src/tracks/types.ts), [Track.ts](../src/tracks/Track.ts), [spline.ts](../src/tracks/spline.ts))
- A circuit is one data object: a closed centripetal Catmull-Rom centreline, resampled every 2 m.
- Everything is generated from it headless, so the server gets the identical collision world:
  - road (with wet patches), auto-placed curbs from curvature, grass shoulders, gravel and tarmac runoff;
  - barriers, with inside-of-corner clamping so offset curves never fold over;
  - terrain that hugs the track and blends into procedural hills.
- Positions can reference control points (`at(cp, offset)`), so details stay attached to corners when the layout changes.

**Kestrel Valley Circuit** (original)
- 2,752 m, clockwise, 18 m elevation change.
- Main features:
  - a 540 m straight;
  - T1 right-hander and climbing ridge esses;
  - downhill right-left;
  - kink plus a 19 m-radius hairpin;
  - the Mill chicane and the final corner.
- Scenery and props: gantry with five start lights, three grandstands, billboards with invented sponsors, brake boards, a tire wall, marshal posts and 1,800 trees.

**Lap timing** ([LapTimer.ts](../src/tracks/LapTimer.ts), headless)
- Laps and 3 sectors, with line crossings interpolated within the physics step.
- Laps only count after passing 12 checkpoints in order, so shortcuts and reversing over the line don't count.
- Track limits invalidate the lap (car centre beyond the curb plus ~1.3 m).
- Best-sector tracking and wrong-way detection.
- Standing start: five lights, then lights out; the car is held on the handbrake until GO.

**Graphics pipeline** ([Graphics.ts](../src/rendering/Graphics.ts), [quality.ts](../src/rendering/quality.ts))
- Cascaded shadow maps: 1–4 cascades with fade.
- GTAO ambient occlusion, at half resolution on High.
- Bloom with an exposure-aware threshold.
- Speed-scaled radial blur.
- ACES tone mapping via OutputPass, MSAA on an HDR target, distance fog, sky IBL.
- Four presets, switched live with G:

| Preset | Draw calls | Triangles |
|---|---|---|
| Low | 100 | 226k |
| Medium | 142 | 279k |
| High | 346 | 716k |
| Ultra | 428 | 828k |

**Effects** ([rendering/effects](../src/rendering/effects))
- Skid marks: one ring buffer of 8,000 quads, coloured per surface.
- One CPU particle system each for smoke/dust/grass/spray and for sparks/flames:
  - tire smoke from slip speed;
  - gravel dust and stones, grass clippings, wet spray;
  - sparks from real chassis contact impulses (Rapier manifolds);
  - exhaust flames on downshifts and high-rpm overrun.

**Replays and cameras**
- A snapshot format (23 floats per frame) now drives the car visual for live, replay and, later, ghost and network cars.
- The recorder keeps the last 90 s at 60 Hz.
- Replay (P): TV director with trackside cameras placed on the outside of corners, auto-zoom to keep the car framed, and periodic helicopter shots. The HUD is hidden during replay.

**Physics**
- Three rays per wheel across the contact patch: each ray is corrected for the tire's circular profile, so wheels roll up onto curb edges.
- Fixes the M1 known issue. The sharp-step jolt drops from 4.2 g to 4.0 g on a 6 cm slab; the circuit's sloped curbs are gentler.

**HUD**
- Lap panel: lap, current, last and best times, sector boxes coloured faster/slower.
- Centre toasts, minimap.
- Debug overlay now shows draw calls, triangles and the current preset.

### Test results

| Test | Result |
|---|---|
| Track build (headless) | 405 ms, 0 barrier gaps |
| Autopilot laps (conservative, ~113 km/h average) | 89.8 s from the grid, 87.4 s flying lap, max lateral deviation 2.8 m, 221 km/h top |
| Render cost at 800×600 in the preview pane | 2.5–5 ms per frame on every preset |

The 1080p, mid-range-GPU target from the spec has not been measured. That is part of the M6 performance pass.

### Bugs found and fixed during M2

- **Bloom washed the screen white.** Bloom runs on HDR values before tone mapping, and with the low exposure the physical sky needs, the whole sky crossed a 0.92 threshold. The threshold now scales with exposure, and emissive lights were boosted so they still bloom.
- **Start lights engaged reverse.** Holding the car on the brake pedal during the start lights triggered auto-reverse at a standstill. The car is now held on the handbrake.
- **High preset issued 1,260 draw calls.** Every small prop and car part was its own draw in every pass (color, shadow cascades, AO). Static props, the car body and wheel parts are now merged per material, and trees are chunked more coarsely: 346 draw calls.
- **Render stats were wrong.** Post-processing reset the counters, so they reported 1 call. They now accumulate per frame.

### Known issues

- **Untested at full window size.** Everything was checked in a hidden, throttled preview pane, so real-time driving feel and frame pacing at 1080p are unverified. Please drive it.
- **Stand-in car model.** The procedural car still looks pale under midday sun (paint and clearcoat tuning). M3 replaces it with proper bodies, metallic flake and liveries.
- **Grandstand crowd.** The crowd texture sits on the seat tops, so the stands read as plain concrete from track level. It should move to the riser faces (M6 polish).
- **Recover without a respawn delay.** Recover (R) puts the car on the centreline at its nearest point. It has no ghosting/no-collide window yet; that is needed for multiplayer (M5).
- **CSM is single-camera.** Split-screen (M5) will need either one CSM per view or a simpler shadow setup for the second view.
- **Replay shows only your car.** It plays back the last 60 s of the player's car. Multi-car replays come with AI (M4).
- **Old 404s in the console.** The console shows four 404s from earlier dev-server reloads. No current page resource fails (all load 200); the favicon request is fixed.
- **Large bundle.** The production bundle is 5.1 MB (1.86 MB gzipped), mostly Rapier's inline WASM. To be handled in the M6 performance pass.

### Next (M3)

- The 6-car roster with distinct handling: formula, GT, rally AWD, muscle RWD, hypercar, FWD hatch.
- Per-class parametric procedural bodies.
- Car paint with clearcoat and metallic flake, plus 4 colours and 1 livery per car.
- Working headlights for sunset.
- Showroom car select with a rotating 3D view, stat bars and depth of field.
