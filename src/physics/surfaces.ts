/**
 * Surface types and their physical properties. Every static collider is tagged with one.
 *
 * gripMul         - multiplies the tire's friction coefficient.
 * peakSlipMul     - loose surfaces (gravel, grass) build a bank of material in front of the
 *                   tire, so peak grip arrives at a larger slip and falls off more gently.
 * rollingResist   - rolling resistance coefficient Crr (force = Crr * Fz).
 * sinkDrag        - extra speed-proportional drag per wheel (N per m/s per kN of load) that
 *                   models a tire ploughing through loose material.
 */
export enum Surface {
  Asphalt = 0,
  Curb = 1,
  Grass = 2,
  Gravel = 3,
  Wet = 4,
}

export interface SurfaceProps {
  name: string;
  gripMul: number;
  peakSlipMul: number;
  rollingResist: number;
  sinkDrag: number;
  /** Visual/audio hint: which particle effect the wheels kick up when slipping. */
  particles: 'smoke' | 'dust' | 'grass' | 'spray';
}

export const SURFACES: Record<Surface, SurfaceProps> = {
  [Surface.Asphalt]: { name: 'Asphalt', gripMul: 1.0, peakSlipMul: 1.0, rollingResist: 0.012, sinkDrag: 0, particles: 'smoke' },
  [Surface.Curb]: { name: 'Curb', gripMul: 0.88, peakSlipMul: 1.0, rollingResist: 0.016, sinkDrag: 0, particles: 'smoke' },
  [Surface.Grass]: { name: 'Grass', gripMul: 0.52, peakSlipMul: 1.5, rollingResist: 0.06, sinkDrag: 1.2, particles: 'grass' },
  [Surface.Gravel]: { name: 'Gravel', gripMul: 0.62, peakSlipMul: 1.8, rollingResist: 0.09, sinkDrag: 2.4, particles: 'dust' },
  [Surface.Wet]: { name: 'Wet asphalt', gripMul: 0.68, peakSlipMul: 0.9, rollingResist: 0.014, sinkDrag: 0.2, particles: 'spray' },
};
