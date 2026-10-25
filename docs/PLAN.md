# APEX DRIFT — Technical Plan (Phase 1 demo)

## Stack and why

| Layer | Choice | Why / trade-off |
|---|---|---|
| Rendering | Three.js r186, WebGL2, PBR (`MeshPhysicalMaterial` for clearcoat paint) | Mature, permissive (MIT), runs everywhere. WebGPU renderer exists in Three, but WebGL2 is the safe default for the demo; the scene code stays compatible. |
| Physics | Rapier 3D (`@dimforge/rapier3d-compat`, Apache-2.0) | Rigid bodies, colliders and ray casts only. **The vehicle model is ours**: Rapier's built-in ray-cast vehicle is not used. The `-compat` build embeds its WASM, so the same code runs in the browser and in Node. |
| Language / build | TypeScript 5.9 + Vite 8 | Fast dev server, one config. |
| Multiplayer | Node.js + `ws` (raw WebSockets), authoritative server | Colyseus adds schema sync we would fight against: the sim needs its own snapshot and input protocol for prediction and reconciliation. Raw `ws` keeps that under our control. |
| Dev tooling | `tsx` (run TS in Node), `concurrently` (one-command start) | Both MIT. |

## Hard rule: simulation ≠ rendering

`src/core`, `src/physics`, `src/vehicles`, `src/ai`, `src/tracks` (data) **must not import `three` or touch the DOM**.
They use their own small math library (`core/math.ts`). That is what lets `server/` run the exact same sim headless,
and it is checked by `npm run sim:headless`, which drives a car with no browser.

## Folder structure

```
src/
  core/        fixed-timestep loop, math, input actions, events, config types
  physics/     Rapier world wrapper, tire model (Pacejka), surfaces
  vehicles/    vehicle sim (suspension, drivetrain, aero, aids), car configs
  rendering/   renderer, environment, car visuals, cameras, post-fx, particles
  audio/       engine synth, SFX, music
  ai/          racing line, AI driver
  network/     client netcode (prediction, interpolation), shared protocol
  ui/          menus, HUD, debug overlay
  tracks/      track data and builders (shared by client and server)
  assets/      generated or authored assets (procedural textures, glTF later)
  main.ts      client entry point
server/        authoritative Node server (imports src/core, physics, vehicles, tracks)
scripts/       headless sim tests and tuning tools
docs/          plan, milestone reports
```

## Vehicle model (M1)

- Fixed physics timestep of **120 Hz**, with render interpolation between the last two states.
- **Per wheel:** a ray cast down the chassis axis, a spring with separate bump and rebound damping, travel limits, and an anti-roll bar per axle.
- **Tire:** a normalised Pacejka magic formula over a **combined-slip vector**: (slip ratio / peak, tan(slip angle) / peak).
  - This gives a friction circle (an ellipse, with separate long/lat μ) for free.
  - Includes load sensitivity: μ drops as the vertical load on the tire Fz rises.
- **Wheel spin integration:** **8 sub-steps per physics step** (960 Hz). A tire stiff enough to feel real makes an explicit wheel spin integrator blow up below about 25 m/s at 120 Hz. The sub-steps, plus a low-speed slip denominator floor, keep it stable down to a standstill.
- **Drivetrain:**
  - Engine torque curve, plus a clutch-slip launch model.
  - Gearbox: auto and manual, with a shift-time torque cut.
  - Final drive.
  - Differentials: open, or clutch-type LSD (preload + lock ratio).
  - FWD, RWD, or AWD with a centre split.
- **Aero:** drag, plus downforce ∝ v² split by an aero-balance value.
- **Brakes:** brake bias and a rear handbrake. Brake torque is clamped so it can never reverse wheel spin, which removes low-speed chatter.
- **Driver aids:** ABS (slip-ratio threshold), TC (slip-ratio throttle cut), and ESC (yaw-rate error against a bicycle model, corrected with individual wheel brakes).
- **Weight transfer is not faked:** it emerges from the springs, the CoM height and the anti-roll bars.
- **Data-driven:** every number lives in `src/vehicles/cars/*.ts`.

## Where the spec is unrealistic for a demo, and the alternatives

| Requirement | Reality | What we'll do |
|---|---|---|
| True per-object motion blur | Needs a velocity buffer, which costs a lot in Three's WebGL path | A speed-scaled radial blur post pass (looks right at speed, cheap) |
| Full lag compensation in a racing game | A rewind-and-resolve of car-vs-car contacts is a research-grade problem | Client-side prediction + server reconciliation for your own car, interpolation for remote cars. The server owns collisions, and corrections are smoothed over ~100 ms. |
| Deterministic sim across machines | Rapier's standard build is not cross-platform deterministic | We don't need lockstep, because reconciliation corrects any drift |
| Cascaded shadows | Fine | Three's `CSM` addon on High and Ultra, a single shadow map on Low and Medium |
| Authored glTF car models | No artist in the loop | Procedural, parametric car bodies built in code (original by construction), with separate meshes for body, wheels, calipers, steering wheel and lights |
| Music | Licensing risk | Generative music synthesised in Web Audio (original, zero licensing) |
| Steering-wheel support | Browsers expose wheels as generic gamepads, and mappings vary | Best-effort axis mapping with a calibration screen in M6 |
| Texture compression (KTX2) | Almost all textures are procedural or generated at runtime | Generated textures stay small. The KTX2 loader is wired in only when authored assets arrive (Phase 2). |

## Milestones

- **M1:** one car on a test plane, with full physics and a debug overlay, plus a headless sim check
- **M2:** track, lap timing, cameras, graphics pipeline (IBL, CSM, post-fx, presets)
- **M3:** 6-car roster, procedural models, paints/liveries, showroom car select
- **M4:** AI drivers, Quick Race, Time Trial ghost
- **M5:** split-screen, online lobby with an authoritative server
- **M6:** audio, UI polish, rebinding, performance pass
