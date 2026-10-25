/** Graphics quality presets. Everything here can be switched live (G key; settings menu in M6). */
export interface QualityPreset {
  name: 'Low' | 'Medium' | 'High' | 'Ultra';
  /** Upper bound on the device pixel ratio. */
  maxPixelRatio: number;
  /** Shadow cascades (CSM) and per-cascade map size. */
  shadowCascades: number;
  shadowMapSize: number;
  /** Shadows are drawn up to this distance from the camera (m). */
  shadowFar: number;
  /** Ground-truth ambient occlusion and its resolution scale. */
  ao: boolean;
  aoScale: number;
  bloom: boolean;
  /** MSAA samples on the main render target (0 = off). */
  msaa: number;
  /** Speed-scaled radial blur. */
  speedBlur: boolean;
  /** Fraction of trees drawn. */
  treeDensity: number;
  /** Max particles alive (smoke, dust, sparks). */
  particles: number;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { name: 'Low', maxPixelRatio: 1, shadowCascades: 1, shadowMapSize: 1024, shadowFar: 120, ao: false, aoScale: 0.5, bloom: false, msaa: 0, speedBlur: false, treeDensity: 0.35, particles: 400 },
  { name: 'Medium', maxPixelRatio: 1, shadowCascades: 2, shadowMapSize: 1024, shadowFar: 200, ao: false, aoScale: 0.5, bloom: true, msaa: 2, speedBlur: true, treeDensity: 0.65, particles: 1000 },
  { name: 'High', maxPixelRatio: 1.5, shadowCascades: 3, shadowMapSize: 2048, shadowFar: 300, ao: true, aoScale: 0.5, bloom: true, msaa: 4, speedBlur: true, treeDensity: 1, particles: 2000 },
  { name: 'Ultra', maxPixelRatio: 2, shadowCascades: 4, shadowMapSize: 2048, shadowFar: 450, ao: true, aoScale: 1, bloom: true, msaa: 4, speedBlur: true, treeDensity: 1, particles: 3500 },
];

export const DEFAULT_QUALITY = 2; // High
