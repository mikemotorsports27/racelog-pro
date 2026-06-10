
export type SessionType = 'Practice' | 'Qualifying' | 'Race' | 'Test';

export interface LapTime {
  lap: number;
  time: string; // MM:SS.mmm
  notes?: string;
}

export interface Setup {
  tirePressure: {
    front: number;
    rear: number;
    unit: 'PSI' | 'BAR';
  };
  frontSuspension: {
    springRate: string;
    preload: string;
    compression: string;
    rebound: string;
    forkHeight: string;
    rideHeight: string;
  };
  rearSuspension: {
    springRate: string;
    preload: string;
    compression: string;
    rebound: string;
    rideHeight: string;
    sag: string;
  };
  fuelLiters: number;
  electronics: {
    abs: string;
    tc: string;
    wc: string;
    eb: string;
    powerMode: string;
  };
  gearing: {
    front: number;
    rear: number;
    finalDrive: number;
    chainNotes: string;
  };
}

export interface Run {
  id: string;
  legId?: string;
  date: string;
  trackName: string;
  sessionType: SessionType;
  runNumber: number;
  weather: string;
  trackCondition: string;
  weight: string;
  riderName: string;
  bikeName: string;
  tireBrand: string;
  notes: string;
  
  bestLapTime: string;
  avgLapTime: string;
  lapsCompleted: number;
  lapTimes: LapTime[];
  
  setup: Setup;
  
  feedbackTags: string[];
  riderComment: string;
  confidenceRating: number;
  gripRating: number;
  stabilityRating: number;
  brakingConfidence: number;
  
  nextRunPlan: string;
}

export interface RaceLeg {
  id: string;
  name: string;
  trackName: string;
  riderName: string;
  bikeName: string;
  startDate: string;
  endDate: string;
  notes: string;
}
