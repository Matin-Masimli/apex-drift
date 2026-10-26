# APEX DRIFT

An original 3D racing game demo built with **Three.js** (rendering), **Rapier** (rigid bodies and collision) and a
**custom sim-cade vehicle model**, in TypeScript with Vite.

> **Status: Milestone 3 of 6.** A garage with six original cars, each distinct in look and handling,
> driven on the original Kestrel Valley circuit, with these in place:
>
> - Full physics.
> - Lap and sector timing with track limits.
> - A standing start from the lights.
> - Cascaded shadows, AO, bloom and speed blur, with Low/Medium/High/Ultra presets.
> - Tire smoke, skid marks, dust, sparks and exhaust flames.
> - A replay with TV-style cameras.
>
> See [docs/PLAN.md](docs/PLAN.md) for the plan and [docs/MILESTONES.md](docs/MILESTONES.md) for progress.

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
| `npm run track:info` | Builds the circuit headless and prints its stats (length, elevation, radii, mesh sizes) |
| `npm run test:lap` | Headless autopilot drives laps through the full physics and lap timer |
| `npm test` | Type-check plus all of the above |

The game opens in the **garage**: pick a car and paint, then press Drive. Esc returns to the garage.

Development URL shortcuts:
- `?drive`: skip the garage. Combine with `&car=<id>&paint=<0-4>` to choose.
- `?level=testpad`: drive the M1 test pad instead of the circuit.

(The multiplayer server and its one-command `npm start` arrive in M5.)

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Throttle / brake | W / S (or ↑ / ↓) | RT / LT |
| Steer | A / D (or ← / →) | Left stick |
| Handbrake | Space | A |
| Shift up / down | E / Q | RB / LB |
| Auto ↔ manual gearbox | M | X |
| Camera (chase / hood / bumper) | C | Y |
| Recover to track (resets the current lap) | R | Back |
| Replay (last 60 s, TV cameras) | P | — |
| Time of day (midday / sunset) | T | — |
| Graphics preset (Low / Medium / High / Ultra) | G | — |
| Hide controls hint | H | — |
| Headlights (automatic at sunset) | L | — |
| Back to garage | Esc | Start |

**Garage:** ← → change car · ↑ ↓ change paint (the fifth option is the livery) · Enter drive · drag to rotate.
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
  tracks/      spline, track builder, lap timer,  ┘
               circuit data
  rendering/   graphics pipeline (CSM, post-fx, presets), environment, track and car visuals,
               cars/ (procedural body builders, paint & livery), cameras, replay director, effects/
  game/        drive session (level + car + loop)
  ui/          input, garage/showroom, HUD, lap HUD, debug overlay, loading screen
  audio/ ai/ network/ assets/   (later milestones)
server/        authoritative multiplayer server (M5)
scripts/       headless bench, track info, autopilot lap test
```

The **simulation runs at a fixed 120 Hz**, decoupled from the frame rate. The renderer interpolates the chassis pose
between the last two physics states.

### Vehicle model in brief

All of this is in [src/vehicles/Vehicle.ts](src/vehicles/Vehicle.ts), [Powertrain.ts](src/vehicles/Powertrain.ts) and
[src/physics/tire.ts](src/physics/tire.ts), with the math commented inline.

- **Suspension.** Three rays per wheel across the contact patch (so the wheel rolls up onto curb edges), with a spring, bump and rebound damping, a bump stop and a per-axle anti-roll
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

## The roster

| Car | Class | Layout | Character |
|---|---|---|---|
| Nimbus Ziva RS | Hot hatch | FWD | Beginner-friendly: forgiving tyres, mild understeer, all aids on |
| Aurel Meridian GT-E | GT endurance | RWD | Balanced and stable, high top speed |
| Talvi RX4 | Rally | AWD | Long-travel suspension; gravel tyres grip 50% better on loose surfaces |
| Harlan Stampede 7.4 | Muscle | RWD | 780 Nm, street tyres, tight LSD: loves to drift |
| Seraph Vanta | Hypercar | RWD | 1,050 hp, highest top speed, snappy at the limit |
| Strale FX-9 | Open-wheel formula | RWD | 730 kg, huge downforce: fastest through corners, least forgiving |

## Adding a new car

1. Copy any file in [src/vehicles/cars/](src/vehicles/cars) to `src/vehicles/cars/<yourCar>.ts`, and change `id`,
   `name` and the numbers. Every field is documented in [src/vehicles/types.ts](src/vehicles/types.ts).
2. The `visual` section sets how it looks:
   - a body `style` (one of the six procedural builders);
   - four paints (`flake`, `pearl` and `matte` finishes);
   - a livery (pattern, colours, race number, invented sponsor text);
   - rim and caliper colours;
   - steering ratio and exhaust positions.
3. The model's proportions come from the physics config itself: collider length and width, wheelbase, track and
   wheel sizes. Changing the chassis changes the body.
4. Register it in [src/vehicles/cars/index.ts](src/vehicles/cars/index.ts). It appears in the garage automatically,
   with specs measured from its physics.
5. Run `npm run sim:headless -- <id>` (0–100, top speed, braking, max lateral g, gravel) and
   `npm run test:lap -- 1 <id>`. Then drive it with the debug overlay (F3) open.

Tuning tips:

| Problem | Try |
|---|---|
| Car snaps into oversteer | Lower the rear anti-roll bar, raise the rear tire `peakSlipAngleDeg`, or move `aero.balance` rearward |
| Car understeers | The opposite of the above, or raise `steering.maxAngleDeg` |
| Falls short of the gear-limited top speed | `aero.dragArea` is too high or the engine is too weak. Gearing caps top speed at the limiter. |
| Wheelspin everywhere | Lower first-gear ratio or `finalDrive`, or raise rear `muLong` |

In the browser console, `__apex.vehicle.config` is live. Edit values there and feel the change immediately.

## Adding a new track

A circuit is one data object, a `TrackDef` (see [src/tracks/types.ts](src/tracks/types.ts)). Everything else is generated
from it by [src/tracks/Track.ts](src/tracks/Track.ts), headless, so the server builds the identical collision world:
- road, curbs, shoulders and runoff;
- barriers and terrain;
- start grid, checkpoints and sectors.

1. Copy [src/tracks/circuits/kestrelValley.ts](src/tracks/circuits/kestrelValley.ts).
2. Lay out `controlPoints`: a closed loop in driving order, with `y` as elevation.
   - Put several points on straights to keep them straight.
   - Put 3 or more points around each corner.
3. Positions along the track are either metres or `at(controlPointIndex, offsetMetres)`. That keeps
   runoff zones, sectors and props attached to corners when you edit the layout.
4. Curbs are placed automatically from curvature (`curbs.minCurvature`, `outsideCurvature`).
5. Gravel traps, tarmac runoff and wet patches are explicit ranges.
6. Props are `{ type, s, side, offset }`: grandstand, gantry, billboard, brake boards, tire wall, marshal post.
7. Check the result with `npm run track:info`, then `npm run test:lap` (it must complete laps).
   - Look for barrier gaps and the tightest radius. Under ~18 m the inside shoulders and barriers get clamped.

To use your track, swap the import in [src/main.ts](src/main.ts). A track-select menu arrives with the mode select in M4.

## Licensing

All code, designs and names are original. Third-party libraries are listed in [CREDITS.md](CREDITS.md).
