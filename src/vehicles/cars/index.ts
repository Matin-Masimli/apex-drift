import type { CarConfig } from '../types';
import { harlanStampede } from './harlanStampede';
import { meridianGT } from './meridianGT';
import { nimbusZiva } from './nimbusZiva';
import { seraphVanta } from './seraphVanta';
import { straleFX9 } from './straleFX9';
import { talviRX4 } from './talviRX4';

/** Car registry, in showroom order. Add a car by creating a config file and listing it here. */
export const CARS: CarConfig[] = [nimbusZiva, meridianGT, talviRX4, harlanStampede, seraphVanta, straleFX9];

export const getCar = (id: string): CarConfig => {
  const car = CARS.find(c => c.id === id);
  if (!car) throw new Error(`Unknown car id "${id}"`);
  return car;
};
