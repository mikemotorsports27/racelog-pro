import { RaceLeg, Run, Setup } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const INITIAL_SETUP: Setup = {
  tirePressure: { front: 29, rear: 27, unit: 'PSI' },
  frontSuspension: { springRate: '10.0', preload: '10', compression: '12', rebound: '10', forkHeight: '5', rideHeight: '0' },
  rearSuspension: { springRate: '95', preload: '12', compression: '10', rebound: '12', rideHeight: '315', sag: '30' },
  fuelLiters: 10,
  electronics: { abs: '1', tc: '3', wc: '2', eb: '2', powerMode: 'Full' },
  gearing: { front: 16, rear: 45, finalDrive: 2.8125, chainNotes: 'Standard' },
};

const hasOldDemoData = (items: Array<Run | RaceLeg>) => items.some(item => (
  item.trackName === 'Circuit de Spa-Francorchamps' ||
  item.riderName === 'Pro Rider' ||
  item.id === 'demo-spa-2026' ||
  item.id === 'demo-brc-2026' ||
  item.id === 'demo-clark-2026'
));

export const getStorageRuns = (): Run[] => {
  const stored = localStorage.getItem('race_runs');
  if (!stored) return [];

  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && hasOldDemoData(parsed)) {
      return [];
    }
    return Array.isArray(parsed) ? parsed.map(run => ({ ...run, weight: run.weight || '' })) : [];
  }
  return [];
};

export const saveStorageRuns = (runs: Run[]) => {
  localStorage.setItem('race_runs', JSON.stringify(runs));
};

export const getStorageLegs = (): RaceLeg[] => {
  const stored = localStorage.getItem('race_legs');
  if (!stored) return [];

  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && hasOldDemoData(parsed)) {
      return [];
    }
    return parsed;
  }
  return [];
};

export const saveStorageLegs = (legs: RaceLeg[]) => {
  localStorage.setItem('race_legs', JSON.stringify(legs));
};

export const createLegFromRun = (run: Run): RaceLeg => ({
  id: uuidv4(),
  name: `${run.trackName} Weekend`,
  trackName: run.trackName,
  riderName: run.riderName,
  bikeName: run.bikeName,
  startDate: run.date,
  endDate: run.date,
  notes: 'Created from existing stint history.'
});

export const formatLapTime = (time: string) => time;

export const timeToMs = (time: string): number => {
  const [min, rest] = time.split(':');
  const [sec, ms] = rest.split('.');
  return (parseInt(min) * 60 * 1000) + (parseInt(sec) * 1000) + parseInt(ms);
};

export const msToTime = (ms: number): string => {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const msec = ms % 1000;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${msec.toString().padStart(3, '0')}`;
};
