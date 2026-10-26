# Roadmap

## Phase 1: Demo (in progress)

| Milestone | Scope | Status |
|---|---|---|
| M1 | One car on a test plane: full physics, debug overlay, headless bench | **Done** |
| M2 | Original 2.75 km circuit, lap timing and sectors, replay cameras, graphics pipeline (IBL, CSM, post-fx, quality presets), effects | **Done** |
| M3 | 6-car roster, procedural models, paints and liveries, showroom car select | **Done** |
| M4 | AI drivers (racing line, braking, overtaking, rubber-banding), Quick Race, Time Trial with ghost | Next |
| M5 | 2-player split-screen; online lobby (room codes, 2–8 players), authoritative server with prediction and reconciliation | |
| M6 | Engine/tire/wind audio, generative music, UI polish, rebinding, performance pass | |

## Phase 2: ideas

- **More content.** Additional circuits (street, mountain pass, rallycross), plus a track editor built on the spline track format.
- **Weather.** Dynamic rain with a drying line, puddles (the wet surface type already exists in the sim), and night racing with real headlights.
- **Car tuning.** A garage UI over the existing data-driven config: gearing, diff lock, ARBs, aero balance, brake bias, tire compounds.
- **Career mode.** Championships across car classes, earnings, upgrades.
- **Leaderboards.** Global time-trial boards with ghost downloads. The server would validate laps by re-simulating inputs headless.
- **Replays.** Input-recorded replays (the sim is replayable from inputs plus the initial state) with a cinematic camera director.
- **Damage.** Visual deformation, plus mechanical effects (alignment, aero loss).
- **Tire wear and temperature.** These would extend the tire model's μ with a thermal state.
- **Force-feedback wheels.** Via WebHID where available.
- **WebGPU renderer path.** Three's WebGPURenderer, once its post-processing stack matures.
