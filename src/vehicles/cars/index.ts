import type { CarConfig } from '../types';
import { meridianGT } from './meridianGT';

/** Car registry. Add a car by creating a config file and listing it here. */
export const CARS: CarConfig[] = [meridianGT];

export const getCar = (id: string): CarConfig => {
  const car = CARS.find(c => c.id === id);
  if (!car) throw new Error(`Unknown car id "${id}"`);
  return car;
};
