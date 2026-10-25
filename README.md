# APEX DRIFT

An original 3D racing game demo built with **Three.js** (rendering), **Rapier** (rigid bodies and collision) and a
**custom sim-cade vehicle model**, in TypeScript with Vite.

> **Status: Milestone 1 of 6.** One car drives on a test pad with full physics, a debug overlay, a HUD,
> chase/hood/bumper cameras and midday/sunset lighting. See [docs/PLAN.md](docs/PLAN.md) for the full plan and
> [docs/MILESTONES.md](docs/MILESTONES.md) for progress.

## Requirements

- Node.js ≥ 20.19 (developed on Node 24)
- A desktop browser with WebGL2 (Chrome, Edge, Firefox)

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |
| `npm run sim:headless` | Runs the vehicle sim in Node (no browser) and prints a performance bench per car |

(The multiplayer server and its one-command `npm start` arrive in M5.)

## Controls (M1)

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Throttle / brake | W / S (or ↑ / ↓) | RT / LT |
| Steer | A / D (or ← / →) | Left stick |
| Handbrake | Space | A |
| Shift up / down | E / Q | RB / LB |
| Auto ↔ manual gearbox | M | X |
| Camera (chase / hood / bumper) | C | Y |
| Reset car | R | Back |
| Time of day (midday / sunset) | T | — |
| Toggle ABS / TC / ESC | 1 / 2 / 3 | — |
| Debug overlay | F3 or ` | — |

In automatic, hold the brake at a standstill to engage reverse. The pedals then swap, so the brake pedal drives backwards.

## Architecture

```
src/
  core/        math, fixed-timestep loop         ┐
  physics/     Rapier wrapper, tire model,       │ headless-safe: no three.js, no DOM.
               surfaces                          │ The server (M5) and scripts/ run this
  vehicles/    vehicle sim, powertrain,          │ exact code.
               car configs                       │
  tracks/      level data + physics builders     ┘
  rendering/   renderer, environment, car visuals, cameras
  ui/          input, HUD, debug overlay
  audio/ ai/ network/ assets/   (later milestones)
server/        authoritative multiplayer server (M5)
scripts/       headless-sim.ts test bench
```

The **simulation runs at a fixed 120 Hz**, decoupled from the frame rate. The renderer interpolates the chassis pose
between the last two physics states.

### Vehicle model in brief

All of this is in [src/vehicles/Vehicle.ts](src/vehicles/Vehicle.ts), [Powertrain.ts](src/vehicles/Powertrain.ts) and
[src/physics/tire.ts](src/physics/tire.ts), with the math commented inline.

- **Suspension.** One ray per wheel, with a spring, bump and rebound damping, a bump stop and a per-axle anti-roll
  bar. Weight transfer emerges from the CoM height and the springs; it is not scripted.
- **Tires.** A normalised Pacejka curve evaluated on a combined-slip vector, which gives a friction ellipse.
  Load sensitivity is included, so grip per kilogram falls as load rises.
- **Wheel spin.** Integrated at 960 Hz (8 sub-steps), implicitly in the tire stiffness, so it stays stable from a
  standstill to top speed.
- **Powertrain.** Torque curve, clutch (launch and locked modes), auto or manual gearbox with shift time, and
  open/LSD differentials. FWD, RWD and AWD layouts with a centre split.
- **Aero and brakes.** Drag plus downforce with aero balance. Brake bias, a handbrake, and brakes that can lock a
  wheel but never spin it backwards.
- **Driver aids.** ABS (slip-ratio modulation), proportional TC, and ESC (yaw-rate error against a bicycle model,
  corrected with single-wheel braking).
- **Surfaces.** Asphalt, curb, grass, gravel and wet asphalt, each with its own grip, peak-slip stretch, rolling
  resistance and "sink" drag. Each car can also scale grip per surface.

## Adding a new car

1. Copy [src/vehicles/cars/meridianGT.ts](src/vehicles/cars/meridianGT.ts) to `src/vehicles/cars/<yourCar>.ts`, and
   change `id`, `name` and the numbers. Every field is documented in [src/vehicles/types.ts](src/vehicles/types.ts).
2. Register it in [src/vehicles/cars/index.ts](src/vehicles/cars/index.ts).
3. Run `npm run sim:headless -- <id>` and check 0-100, top speed, braking and skid-pad g. Then drive it with
   the debug overlay (F3) open.

Tuning tips:

| Problem | Try |
|---|---|
| Car snaps into oversteer | Lower the rear anti-roll bar, raise the rear tire `peakSlipAngleDeg`, or move `aero.balance` rearward |
| Car understeers | The opposite of the above, or raise `steering.maxAngleDeg` |
| Falls short of the gear-limited top speed | `aero.dragArea` is too high or the engine is too weak. Gearing caps top speed at the limiter. |
| Wheelspin everywhere | Lower first-gear ratio or `finalDrive`, or raise rear `muLong` |

In the browser console, `__apex.vehicle.config` is live. Edit values there and feel the change immediately.

## Adding a new track

M1 has a data-driven test pad: [src/tracks/testPad.ts](src/tracks/testPad.ts). It is a list of tagged boxes that both
the physics builder and the renderer read. M2 introduces the circuit format (centreline spline + width + surface
bands + checkpoints), and this section will be expanded then.

## Licensing

All code, designs and names are original. Third-party libraries are listed in [CREDITS.md](CREDITS.md).
