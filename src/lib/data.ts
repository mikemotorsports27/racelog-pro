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

export const DEMO_RUNS: Run[] = [
  {
    id: uuidv4(),
    legId: 'demo-brc-2026',
    date: '2026-06-01',
    trackName: 'Batangas Racing Circuit',
    sessionType: 'Practice',
    runNumber: 1,
    weather: 'Hot',
    trackCondition: 'Dry, Hot',
    weight: '64 kg',
    riderName: 'Jacq Buncio',
    bikeName: 'Yamaha YZF-R6',
    tireBrand: 'Pirelli Diablo Superbike SC1/SC2',
    notes: 'Opening practice at Batangas. Baseline check for braking stability into Turn 1.',
    bestLapTime: '01:44.820',
    avgLapTime: '01:46.210',
    lapsCompleted: 8,
    lapTimes: [
      { lap: 1, time: '01:49.420' },
      { lap: 2, time: '01:46.210' },
      { lap: 3, time: '01:44.820' }
    ],
    setup: INITIAL_SETUP,
    feedbackTags: ['Good overall balance', 'Bike unstable on braking'],
    riderComment: 'Good baseline pace. Front needs more support under hard braking and direction changes.',
    confidenceRating: 4,
    gripRating: 4,
    stabilityRating: 5,
    brakingConfidence: 4,
    nextRunPlan: 'Add one click front compression and monitor entry stability.'
  },
  {
    id: uuidv4(),
    legId: 'demo-brc-2026',
    date: '2026-06-01',
    trackName: 'Batangas Racing Circuit',
    sessionType: 'Practice',
    runNumber: 2,
    weather: 'Humid',
    trackCondition: 'Dry',
    weight: '64 kg',
    riderName: 'Jacq Buncio',
    bikeName: 'Yamaha YZF-R6',
    tireBrand: 'Pirelli Diablo Superbike SC1/SC2',
    notes: 'Front compression change and tire pressure check.',
    bestLapTime: '01:43.960',
    avgLapTime: '01:44.870',
    lapsCompleted: 9,
    lapTimes: [
      { lap: 1, time: '01:45.310' },
      { lap: 2, time: '01:43.960' },
      { lap: 3, time: '01:44.120' }
    ],
    setup: {
      ...INITIAL_SETUP,
      frontSuspension: { ...INITIAL_SETUP.frontSuspension, compression: '11' }
    },
    feedbackTags: ['Better high-speed stability', 'Good overall balance'],
    riderComment: 'Better support into the braking zones. Bike feels more settled on corner entry.',
    confidenceRating: 5,
    gripRating: 4,
    stabilityRating: 4,
    brakingConfidence: 5,
    nextRunPlan: 'Keep front setting and try one PSI lower rear pressure for drive grip.'
  },
  {
    id: uuidv4(),
    legId: 'demo-clark-2026',
    date: '2026-06-08',
    trackName: 'Clark International Speedway',
    sessionType: 'Practice',
    runNumber: 1,
    weather: 'Sunny',
    trackCondition: 'Dry, Hot',
    weight: '64 kg',
    riderName: 'Jacq Buncio',
    bikeName: 'Yamaha YZF-R6',
    tireBrand: 'Pirelli Diablo Superbike SC1/SC2',
    notes: 'Initial Clark outing. Focus on gearing and drive out of long corners.',
    bestLapTime: '02:05.440',
    avgLapTime: '02:07.300',
    lapsCompleted: 7,
    lapTimes: [
      { lap: 1, time: '02:10.220' },
      { lap: 2, time: '02:07.300' },
      { lap: 3, time: '02:05.440' }
    ],
    setup: {
      ...INITIAL_SETUP,
      gearing: { ...INITIAL_SETUP.gearing, rear: 44, finalDrive: 2.75 }
    },
    feedbackTags: ['Better acceleration', 'Front pushes wide'],
    riderComment: 'Strong acceleration, but the bike starts to push wide on longer corner exits.',
    confidenceRating: 4,
    gripRating: 3,
    stabilityRating: 4,
    brakingConfidence: 4,
    nextRunPlan: 'Try rear ride height adjustment and review gearing after another timed stint.'
  }
];

export const DEMO_LEGS: RaceLeg[] = [
  {
    id: 'demo-brc-2026',
    name: 'Batangas Test Weekend',
    trackName: 'Batangas Racing Circuit',
    riderName: 'Jacq Buncio',
    bikeName: 'Yamaha YZF-R6',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    notes: 'Baseline Philippine Superbike setup work at BRC.'
  },
  {
    id: 'demo-clark-2026',
    name: 'Clark Practice Weekend',
    trackName: 'Clark International Speedway',
    riderName: 'Jacq Buncio',
    bikeName: 'Yamaha YZF-R6',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    notes: 'Gearing and drive-grip validation at Clark.'
  }
];

const hasOldDemoData = (items: Array<Run | RaceLeg>) => items.some(item => (
  item.trackName === 'Circuit de Spa-Francorchamps' ||
  item.riderName === 'Pro Rider' ||
  item.id === 'demo-spa-2026'
));

export const getStorageRuns = (): Run[] => {
  const stored = localStorage.getItem('race_runs');
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && hasOldDemoData(parsed)) {
      return DEMO_RUNS;
    }
    return Array.isArray(parsed) ? parsed.map(run => ({ ...run, weight: run.weight || '' })) : DEMO_RUNS;
  }
  return DEMO_RUNS;
};

export const saveStorageRuns = (runs: Run[]) => {
  localStorage.setItem('race_runs', JSON.stringify(runs));
};

export const getStorageLegs = (): RaceLeg[] => {
  const stored = localStorage.getItem('race_legs');
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && hasOldDemoData(parsed)) {
      return DEMO_LEGS;
    }
    return parsed;
  }
  return DEMO_LEGS;
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
