# Credits & Licenses

APEX DRIFT's game code, car designs, names, track layouts, UI and generated textures are original work.
No third-party art, audio, fonts or vehicle likenesses are used. All textures are drawn procedurally at
runtime ([src/rendering/proceduralTextures.ts](src/rendering/proceduralTextures.ts)).

## Runtime dependencies (shipped to players)

| Package | Version | License | Source | Used for |
|---|---|---|---|---|
| three | 0.186.1 | MIT | https://github.com/mrdoob/three.js | Rendering. Includes these addons from `three/examples/jsm` (same MIT license): `Sky`, `RoundedBoxGeometry`, `CSM`, `EffectComposer`, `RenderPass`, `GTAOPass`, `UnrealBloomPass`, `ShaderPass`, `OutputPass`, `BufferGeometryUtils`, `RoomEnvironment` and `BokehPass`. |
| @dimforge/rapier3d-compat | 0.21.0 | Apache-2.0 | https://github.com/dimforge/rapier | Rigid-body physics, collision, ray casts |

## Development dependencies (not shipped)

| Package | Version | License | Source |
|---|---|---|---|
| vite | 8.3.5 | MIT | https://github.com/vitejs/vite |
| typescript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| tsx | 4.23.15 | MIT | https://github.com/privatenumber/tsx |
| @types/three | 0.186.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | ^24 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Techniques referenced (no code copied)

- Pacejka "magic formula" tire model: H. B. Pacejka, *Tire and Vehicle Dynamics*.
- Fixed-timestep accumulator with render interpolation: the widely documented "Fix Your Timestep" pattern.
- Bicycle-model yaw-rate reference for stability control: standard vehicle-dynamics texts.
- Centripetal Catmull-Rom parameterisation and Barry–Goldman evaluation: standard spline literature.
- Racing line by curvature relaxation, after Rémi Coulom's K1999 approach (technique only).
- Pure-pursuit path tracking: standard robotics / autonomous-driving literature.
- AI driver names are invented.

All names are invented for this project. That includes track names and circuit layouts, car makes and models
(Nimbus, Aurel, Talvi, Harlan, Seraph, Strale) and sponsor names (Voltar, Northwind, Tundra Oil). All car bodies are
generated procedurally from each car's own dimensions; no real vehicle is modelled or referenced.
