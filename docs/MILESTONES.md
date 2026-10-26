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

---

## M3: Six-car roster, procedural models, garage ✅

**Runs:**
- `npm run dev` opens the garage. Pick a car and paint, press Drive, and Esc returns.
- `npm test` passes: bench for all six cars, track build, and one autopilot lap per car.
- `npm run build` passes.

### What was done

**Roster** ([src/vehicles/cars](../src/vehicles/cars)). Six original cars. Each has its own suspension, tyres, engine curve, gearing, diffs, aero and default aids:

| Car | Layout | Power | 0–100 | Top speed | 100–0 | Max lat g | 0–100 gravel |
|---|---|---|---|---|---|---|---|
| Nimbus Ziva RS (hatch) | FWD | 209 hp | 6.1 s | 235 | 36.8 m | 1.03 | 9.6 s |
| Aurel Meridian GT-E (GT) | RWD | 536 hp | 3.6 s | 298 | 29.2 m | 1.26 | 6.6 s |
| Talvi RX4 (rally) | AWD | 297 hp | 4.3 s | 236 | 40.1 m | 0.97 | **5.0 s** |
| Harlan Stampede 7.4 (muscle) | RWD | 561 hp | 5.6 s | 293 | 41.6 m | 0.90 | 11.6 s |
| Seraph Vanta (hyper) | RWD | 1,050 hp | 3.9 s | **424** | 35.3 m | 1.20 | 8.5 s |
| Strale FX-9 (formula) | RWD | 667 hp | **3.1 s** | 309 | **23.3 m** | **2.24** | 7.7 s |

The numbers back up the brief:
- The formula car corners and brakes hardest; at 2.24 g, downforce is doing the work.
- The hypercar is fastest in a straight line, and without TC it takes 6.8 s to 100 (wheelspin).
- The rally car is the gravel specialist.
- The muscle car has the least grip and a tight diff for drifting.
- The hatch is the forgiving starter.

**Procedural bodies** ([src/rendering/cars](../src/rendering/cars))
- A loft builder sweeps superellipse cross-sections along the car.
- Wheel arches are cut as circles in the floor profile.
- A second loft forms the greenhouse, split by face into glass and painted roof/pillars.
- Six class builders:
  - GT: fastback, pylon wing, splitter, diffuser.
  - Rally: tall hatch, four-lamp pod, arch flares, mud flaps, roof scoop and spoiler.
  - Muscle: long hood, notchback, quad lamps, chrome bumpers, hood scoop, ducktail.
  - Hyper: cab-forward teardrop, side intakes, active wing, louvres, big diffuser.
  - Hatch: upright tail, roof spoiler.
  - Formula: tub, side pods, front/rear wings, halo, wishbones.
- Proportions come from each car's physics dimensions.
- Separate meshes for body, wheels (lathe-profiled tyres, class-specific rims), calipers, steering wheel (turns with the front wheels) and lights.
- Static parts are merged by material, so a full car costs around 12–15 draw calls.

**Paint** ([materials.ts](../src/rendering/cars/materials.ts))
- Clear-coated metallic paint, with a flake normal map on the base layer only, so the clear coat stays glossy.
- Pearl (iridescent) and matte finishes.
- Four paints plus one livery per car (24 paints and 6 liveries in total).
- Liveries are drawn on a canvas in the body's UV space:
  - endurance stripes, chevrons, rally bands, twin stripes and two-tone split patterns;
  - race-number roundels and invented sponsor text, readable on both sides.
- Brake lights, plus headlights with real spot lights (L key, automatic at sunset).

**Garage** ([Showroom.ts](../src/ui/Showroom.ts))
- Studio scene with RoomEnvironment reflections, a glossy floor and a rotating turntable with a glow ring.
- Soft key-light shadow, rim light, and subtle depth of field (BokehPass).
- Panel content:
  - class, name and backstory;
  - power, torque, weight and drive layout;
  - top speed (derived from gearing and drag);
  - 0–100, measured by actually simulating the car headless.
- Rating bars, paint swatches, car carousel, keyboard and drag controls, and the last selection remembered.

**App structure**
- One shared WebGL renderer.
- `DriveSession` owns a level, car and loop, and disposes everything (scene, physics, DOM) on exit.
- `main.ts` is now a small state machine: boot → garage ⇄ drive.
- Verified in the browser: garage → drive → Esc → garage → drive a different car. No HUD left behind, all shader programs compile.

### Bugs found and fixed during M3

- **Clutch could lock below idle.** The clutch locked whenever engine and driveline speeds matched, including below idle. On gravel the hatch's engine was dragged down and locked into an unrecoverable 8 rpm stall. Locking now requires the driveline to be turning at least idle speed.
- **TC and ABS ignored surface.** They judged slip against the tyre's asphalt peak, but loose surfaces stretch the peak, so on gravel TC strangled the throttle. Both now normalise by the surface-adjusted peak.
- **Skid-pad test wasn't comparable between cars.** The fixed-steer test asked the muscle car for ~1.6 g and it spun. It was replaced with a closed-loop circle test, whose first version had its lookahead behind the car (also caught and fixed).
- **CSM addon broke pearl paint.** The CSM addon in three r186 injects a stale shader chunk that writes a removed field (`material.iridescenceF0`), so pearl paint failed to compile and rendered black. Graphics now splices the core iridescence block back into the CSM chunk.

### Known issues

- **Pace and feel unverified.** Everything was checked in a hidden, throttled preview pane and by headless tests. Real-time driving feel per car, and 1080p frame rate, still need a human drive.
- **Wishbones are static.** The formula car's wishbones sit at static ride height; at full suspension travel they can visibly disconnect from the wheels by a few cm.
- **Livery coverage.** Liveries cover the main body only; roofs and wings take the livery base colour. The same UV layout means stripes narrow slightly toward the nose and tail.
- **Headlight cost.** Headlights are two spot lights per car. That is fine for one car, but AI fields in M4 should use them only on the player car or a cheaper fake.
- **No showroom bloom.** The turntable ring glows via its emissive colour only.
- **Large bundle.** The bundle is still 5.1 MB (1.88 MB gzipped), mostly Rapier's inline WASM (M6).

### Next (M4)

- AI drivers: racing line from the track spline, braking points from curvature and per-car grip, overtaking, avoidance, rubber-banding toggle.
- Quick Race (3–7 opponents, Easy/Medium/Hard) with positions, a results podium and multi-car replays.
- Time Trial with a ghost of the best lap, built on the snapshot recorder.
- A mode select screen between the garage and the track.

---

## M4: AI opponents, Quick Race, Time Trial with ghost ✅

**Runs:**
- `npm run dev`: garage → Drive → mode select → race.
- `npm test` passes. It now includes headless AI races: an 8-car GT field, an 8-car mixed-class field on hard, and a 6-car easy hatch field, all with real collisions.
- `npm run build` passes.

### What was done

**Racing line** ([src/ai/RacingLine.ts](../src/ai/RacingLine.ts))
- A minimum-curvature line by K1999-style relaxation.
- Its tightest radius is 23.3 m, against 19.2 m on the centreline, and it is 36 m shorter per lap.
- An earlier "pull to the neighbours' midpoint" version minimised length instead, and hugged the hairpin at a *tighter* 12.4 m radius. It was replaced.

**Speed profile** (per car and difficulty)
- Corner limit with downforce: v²κ = μ(g + (c + κᵥ)v²), where κᵥ is the road's vertical curvature (crests lose grip).
- Uses windowed curvature (margin for S-bends).
- Wet-patch grip.
- Friction-circle braking and acceleration passes.
- Traction and power limits.

**AI driver** ([src/ai/AIDriver.ts](../src/ai/AIDriver.ts))
- Pure pursuit with yaw damping and countersteer.
- Required-deceleration braking.
- Progressive throttle that holds driven-wheel slip below peak (rate scaled by power-to-weight).
- Traffic handling: passes only on straights or around obstacles, never in the wet, keeps side-by-side spacing, brakes for the car ahead, holds the grid lane at the start.
- Rubber-banding toggle.
- Stuck/backwards detection.

**Race rules, headless** ([src/game/RaceSim.ts](../src/game/RaceSim.ts))
- Grid, lights-out start, continuous race distance for positions.
- Lap counting through the ordered checkpoints, finishing order.
- Race closes 60 s after the leader or 30 s after the player.
- Recovery that keeps race progress.
- Mixed-class grids ordered by predicted pace.
- The player's car drives its cool-down lap on autopilot.

**Modes** ([src/game/DriveSession.ts](../src/game/DriveSession.ts))
- **Quick Race:**
  - Options: 3–7 opponents, difficulty, laps, field, catch-up.
  - The player starts from the back.
  - During the race: standings tower with gaps, position/lap counter, all cars on the minimap.
  - At the finish: banner, results table (time, gap, best lap), podium with the top three parked and an orbiting camera.
  - Actions: race again, watch replay (all cars), garage.
- **Time Trial:**
  - Timing from the line.
  - The best clean lap becomes a ghost, recorded at 30 Hz (~280 KB) and saved to localStorage per car.
  - A translucent ghost car plus a live ± delta at the same track position. The mode select shows your ghost time.
- **Free Practice:** as before.
- **Pause menu:** Resume / Restart / Garage. **Mode select** panel in the garage, remembering its settings.

**Rendering costs**
- Lower car tessellation: 13k triangles per car.
- Merged steering wheel.
- Small or enclosed parts no longer cast shadows.
- An 8-car race on High went from 1,657 to ~1,000 draw calls per frame.

### AI test results (headless, 12–16× real time)

Hard difficulty, solo laps from the grid:

| Car | Lap |
|---|---|
| Formula | 62.8 s |
| GT | 78.4 s |
| Hyper | 78.6 s |
| Rally | 89 s |
| Hatch | 94 s |
| Muscle | 97 s |

Every car is clean from either grid column. Typical full-field results:

| Field | Recoveries |
|---|---|
| 8 GTs, 2 laps, medium | 0–3 |
| 8 mixed classes, 2 laps | 1–3 |
| 6 hatches, easy | 0 |
| 8 muscle cars, 3 laps, hard | 9 (the deliberately tail-happy car) |

### How the AI was tuned

Each fix came from a reproducible headless trace:
- **T1 snap:** stability control on for the AI.
- **Over a crest:** vertical curvature added to the profile.
- **Running wide in an S-bend under braking:** required-deceleration braking instead of flat-out braking.
- **Power-on spins on straights:** throttle feeding.
- **Weaving at 150 km/h:** pure-pursuit oscillation, fixed with a speed-scaled lookahead plus yaw damping.
- **Pile-ups on the wet patch during passes:** no passing in the wet.
- **Cars queuing behind wrecks:** obstacles can be passed anywhere.
- **Launch collisions:** grid lane hold.

### Bugs found and fixed during M4

- **Race distance jumped at the start line.** `LapTimer.raceDistance` jumped back a full lap when grid cars first crossed the line, which would have scrambled positions. It is now an integrated, wrap-aware distance.
- **Podium inside the grandstand.** The podium was first placed inside the main grandstand; it moved to the open side of the straight.

### Known issues

- **Muscle-car fields on hard.** Fields of muscle cars on hard still spin a few times per race (about one recovery per three car-laps).
- **No slipstream or dirty air.** Passing relies on pace differences and braking zones.
- **Recovery has no no-collide window.** A recovered car is placed on a free lateral slot, but it is not ghosted.
- **Results timeout.** Race results classify cars still running 60 s after the leader by distance. A big field of slow cars in a mixed race can get cut off.
- **Player lap timing excludes the grid run.** The player's lap 1 timing starts at the first line crossing (12 m from the grid); total race time does include it.
- **Draw calls.** ~1,000 per frame on High with 8 cars bunched. A car-LOD and impostor pass is planned for M6.
- **Pace and feel unverified.** Everything was again verified in a throttled preview pane and headless. AI pace and racecraft against a human, and 1080p frame rate, still need a human session.

### Next (M5)

- 2-player split-screen (keyboard + gamepad), with per-view cameras and a simplified shadow setup for the second view.
- Online: Node `ws` authoritative server running `RaceSim` headless.
- Room codes, lobby (car select, ready-up, host picks laps), 2–8 players.
- Client-side prediction with server reconciliation, interpolation of remote cars, graceful disconnects (an AI takes over or the car is removed).
