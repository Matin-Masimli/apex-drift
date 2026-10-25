/**
 * Fixed-timestep accumulator ("Fix Your Timestep").
 *
 * Physics always advances in exact `stepDt` increments regardless of render rate,
 * which keeps the vehicle model stable and makes client/server simulation match.
 * `alpha` (0..1) tells the renderer how far we are between the last two physics states,
 * so it can interpolate and avoid judder when render Hz != physics Hz.
 */
export class FixedStepLoop {
  private accumulator = 0;
  /** Interpolation factor between previous and current physics state. */
  alpha = 0;
  /** Total simulated steps since start (useful as a network tick). */
  tick = 0;

  constructor(
    readonly stepDt = 1 / 120,
    /** Cap on steps per frame so a long frame (tab switch, GC) can't spiral. */
    private readonly maxStepsPerFrame = 8,
  ) {}

  /** Advance by a real frame delta; calls `step` zero or more times. Returns steps taken. */
  advance(frameDt: number, step: (dt: number, tick: number) => void): number {
    this.accumulator += Math.min(frameDt, this.stepDt * this.maxStepsPerFrame);
    let steps = 0;
    while (this.accumulator >= this.stepDt) {
      step(this.stepDt, this.tick++);
      this.accumulator -= this.stepDt;
      steps++;
    }
    this.alpha = this.accumulator / this.stepDt;
    return steps;
  }
}
