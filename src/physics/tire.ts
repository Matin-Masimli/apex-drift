/**
 * Tire model: a normalised Pacejka "magic formula" applied to a combined-slip vector.
 *
 * Classic Pacejka:  F(x) = D · sin(C · atan(B·x − E·(B·x − atan(B·x))))
 *   D = peak force, C = shape (sets how far force falls past the peak), B = stiffness, E = curvature.
 *
 * Instead of two independent curves for longitudinal (slip ratio κ) and lateral (slip angle α),
 * we normalise each slip by its own peak value:
 *     sx = κ / κ_peak,      sy = tan(α) / tan(α_peak)
 * and evaluate a single curve over s = |(sx, sy)|. The resulting force is split back along the
 * slip vector's direction and scaled by separate μx / μy. That gives:
 *   - a friction *ellipse* (combined slip): braking while cornering correctly steals lateral grip,
 *   - a peak at exactly s = 1 for both axes (easy to tune: "peak slip angle 7°"),
 *   - a single place where load sensitivity and surface grip apply.
 */

export interface TireParams {
  /** Peak friction coefficient, longitudinal. */
  muLong: number;
  /** Peak friction coefficient, lateral. */
  muLat: number;
  /** Slip ratio at peak longitudinal force (typ. 0.08–0.15). */
  peakSlipRatio: number;
  /** Slip angle at peak lateral force, degrees (typ. 5–10; lower = sharper/twitchier tire). */
  peakSlipAngleDeg: number;
  /** Magic formula shape C. 1.2 = flat plateau past the peak (forgiving), 1.8 = big drop (snappy). */
  shape: number;
  /**
   * Load sensitivity: μ falls as load rises. μ_eff = μ · (1 − k · (Fz/Fz_nom − 1)).
   * This is *why* weight transfer reduces total grip, and why anti-roll bars change balance.
   */
  loadSensitivity: number;
  /** Nominal load (N) at which μ equals the quoted value. */
  nominalLoad: number;
}

/** Pre-computed curve constants for a tire, so the hot path is just a few trig calls. */
export class TireCurve {
  readonly B: number;
  readonly C: number;
  /** Small-slip limit of F(s)/s: the curve's initial slope. Used when s ≈ 0. */
  readonly slope0: number;

  constructor(shape: number) {
    this.C = shape;
    // We want the peak at s = 1: C·atan(B) = π/2  ⇒  B = tan(π / (2C)).  (E is fixed at 0.)
    this.B = Math.tan(Math.PI / (2 * shape));
    // sin(C·atan(B·s)) ≈ C·B·s for small s.
    this.slope0 = this.B * this.C;
  }

  /** Normalised force (0..1, equal to 1 at s = 1) for a combined slip magnitude s >= 0. */
  evaluate(s: number): number {
    return Math.sin(this.C * Math.atan(this.B * s));
  }

  /** F(s)/s, numerically safe at s → 0. */
  ratio(s: number): number {
    return s < 1e-5 ? this.slope0 : this.evaluate(s) / s;
  }
}

export interface TireForceResult {
  fx: number;
  fy: number;
  /** Fraction of available grip in use, 0..~1 (above 1 never happens; > ~0.95 means at the limit). */
  gripUsed: number;
  /** Combined normalised slip; > 1 means past the peak (sliding). */
  combinedSlip: number;
}

/**
 * Compute tire forces in the contact frame.
 *
 * @param slipRatio      κ = (ω·R − v_long) / |v_long|   (+ = spinning, − = locking)
 * @param tanSlipAngle   tan(α) = v_lat / |v_long|       (+ = sliding to the right)
 * @param fz             vertical load (N)
 * @param surfaceGrip    combined surface × tire-on-surface grip multiplier
 * @param peakSlipMul    surface stretch of the peak slip values
 */
export function computeTireForce(
  p: TireParams,
  curve: TireCurve,
  slipRatio: number,
  tanSlipAngle: number,
  fz: number,
  surfaceGrip: number,
  peakSlipMul: number,
  out: TireForceResult,
): TireForceResult {
  if (fz <= 0) {
    out.fx = 0; out.fy = 0; out.gripUsed = 0; out.combinedSlip = 0;
    return out;
  }
  const sx = slipRatio / (p.peakSlipRatio * peakSlipMul);
  const sy = tanSlipAngle / (Math.tan(p.peakSlipAngleDeg * (Math.PI / 180)) * peakSlipMul);
  const s = Math.hypot(sx, sy);

  // Load sensitivity, clamped so very light or very heavy loads stay sane.
  const loadFactor = Math.max(0.6, 1 - p.loadSensitivity * (fz / p.nominalLoad - 1));
  const muScale = loadFactor * surfaceGrip;

  // Force magnitude along the slip vector, then decomposed. Lateral force opposes lateral slip.
  const r = curve.ratio(s);
  out.fx = p.muLong * muScale * fz * r * sx;
  out.fy = -p.muLat * muScale * fz * r * sy;
  out.combinedSlip = s;
  out.gripUsed = curve.evaluate(s);
  return out;
}
