import type { V3 } from '../core/math';
import type { Surface } from '../physics/surfaces';

/**
 * Data-driven circuit definition. A new track is one of these plus (optionally) a scenery hook.
 * Everything is derived from a closed centreline spline: road, curbs, runoff, barriers, terrain,
 * checkpoints, sectors and the start grid.
 *
 * Positions along the track (`TrackPos`) are either metres along the centreline from the first
 * control point, or a reference to a control point plus an offset in metres, which keeps the data
 * readable and stable when the layout is edited.
 */

export type TrackPos = number | { cp: number; offset?: number };

export type Side = 'left' | 'right' | 'both';

export interface TrackRange {
  from: TrackPos;
  to: TrackPos;
}

export interface CurbRule {
  /** Curbs are placed automatically wherever |curvature| exceeds this (1/m). */
  minCurvature: number;
  width: number;
  /** Raised outer lip height (m). */
  height: number;
  /** Also place a curb on the outside of corners tighter than this curvature. */
  outsideCurvature: number;
}

export interface RunoffZone extends TrackRange {
  side: Side;
  surface: Surface;
  width: number;
}

export interface TrackProp {
  type: 'grandstand' | 'gantry' | 'billboard' | 'marshalPost' | 'brakeBoards' | 'tireWall';
  s: TrackPos;
  side: Side;
  /** Lateral distance from the track edge (m). */
  offset: number;
  /** Size along the track (m), where meaningful. */
  length?: number;
  /** Free text for billboards. */
  label?: string;
}

export interface TrackDef {
  id: string;
  name: string;
  description: string;
  /** Closed loop of control points (x, y = elevation, z), in driving order. */
  controlPoints: V3[];
  /** Road width (m). */
  width: number;
  /** Default grass shoulder width each side (m). */
  shoulderWidth: number;
  curbs: CurbRule;
  /** Explicit runoff areas (gravel traps, extra tarmac) replacing the default grass shoulder. */
  runoff: RunoffZone[];
  /** Road sections with a wet surface (puddles). */
  wetPatches: TrackRange[];
  /** Barrier distance from the track edge (m); clamped on the inside of tight corners. */
  barrierOffset: number;
  /** Position of the start/finish line. */
  startLine: TrackPos;
  /** Sector boundaries after the start line; the lap is split into sectors.length + 1 parts. */
  sectors: TrackPos[];
  /** Number of evenly spaced checkpoints that must be passed in order for a lap to count. */
  checkpointCount: number;
  props: TrackProp[];
  scenery: {
    /** Approximate number of trees. */
    trees: number;
    /** Terrain base height far from the track (m). */
    baseHeight: number;
    /** Half-size of the terrain square (m). */
    terrainHalfSize: number;
    /** Gentle procedural hills amplitude (m) away from the track. */
    hillAmplitude: number;
  };
  timeOfDay: 'midday' | 'sunset';
}
