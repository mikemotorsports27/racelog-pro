import { useState, useEffect, useMemo, useRef } from 'react';
import type React from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  GitCompare, 
  Settings, 
  Flame, 
  History, 
  Zap, 
  ChevronRight, 
  Trophy, 
  Thermometer, 
  Droplets, 
  Trash2,
  Copy,
  Edit,
  ArrowUp,
  ArrowDown,
  Info,
  ChevronDown,
  Clock,
  Gauge,
  Activity,
  Wind,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  Palette,
  Upload,
  RotateCcw,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area
} from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import confetti from 'canvas-confetti';

import { RaceLeg, Run, Setup, SessionType } from './types';
import { 
  createLegFromRun,
  getStorageLegs,
  getStorageRuns, 
  saveStorageLegs,
  saveStorageRuns, 
  INITIAL_SETUP, 
  timeToMs, 
} from './lib/data';
import { cn } from './lib/utils';
import { isSupabaseConfigured, supabase } from './lib/supabase';

// --- Constants ---
const FEEDBACK_TAGS = [
  'Front feels light', 'Front pushes wide', 'Rear slides', 'Bike unstable on braking',
  'Better corner exit', 'Better acceleration', 'More grip', 'Less grip',
  'Hard to turn', 'Easy to turn', 'Wheelie too much', 'TC cutting too much',
  'ABS too intrusive', 'Good overall balance', 'Rear squats too much',
  'Front too stiff', 'Rear too soft', 'Better high-speed stability'
];

const WEATHER_OPTIONS = ['Sunny', 'Hot', 'Humid', 'Cloudy', 'Overcast', 'Windy', 'Light Rain', 'Rain'];
const TRACK_CONDITION_OPTIONS = ['Dry', 'Dry, Hot', 'Dry, Cool', 'Damp', 'Wet', 'Dusty', 'Green Track'];

type AppSettings = {
  primaryColor: string;
  secondaryColor: string;
  dangerColor: string;
  logoDataUrl: string;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  primaryColor: '#3CB6E3',
  secondaryColor: '#0038A8',
  dangerColor: '#DE0000',
  logoDataUrl: ''
};

type View = 'dashboard' | 'logbook' | 'add' | 'details' | 'compare' | 'settings';

type SharedAppState = {
  schemaVersion: 1;
  runs: Run[];
  legs: RaceLeg[];
  activeLegId: string | null;
  appSettings: AppSettings;
};

const SHARED_STATE_ID = 'default';
const LOGO_MAX_DIMENSION = 320;
const LOGO_MAX_DATA_URL_LENGTH = 450_000;

function formatDisplayDate(value?: string) {
  if (!value) return '--';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function describeSyncError(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeAppSettings(settings?: Partial<AppSettings>): AppSettings {
  const nextSettings = { ...DEFAULT_APP_SETTINGS, ...(settings || {}) };
  const logoDataUrl = typeof nextSettings.logoDataUrl === 'string' ? nextSettings.logoDataUrl : '';

  return {
    ...nextSettings,
    logoDataUrl: logoDataUrl.length <= LOGO_MAX_DATA_URL_LENGTH ? logoDataUrl : '',
  };
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to read logo image.'));
    };
    image.src = objectUrl;
  });
}

async function resizeLogoFile(file: File): Promise<string> {
  const image = await loadImageFromFile(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to process logo image.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}

export default function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [legs, setLegs] = useState<RaceLeg[]>([]);
  const [activeLegId, setActiveLegId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [editingLeg, setEditingLeg] = useState<RaceLeg | null>(null);
  const [isLegModalOpen, setIsLegModalOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'local' | 'syncing' | 'synced' | 'error'>(
    isSupabaseConfigured ? 'syncing' : 'local'
  );
  const applyingRemoteState = useRef(false);
  const lastRemoteUpdate = useRef<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      return normalizeAppSettings(JSON.parse(localStorage.getItem('app_settings') || '{}'));
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  });

  const buildLocalState = (): SharedAppState => {
    const storedRuns = getStorageRuns();
    let storedLegs = getStorageLegs();

    if (storedLegs.length === 0 && storedRuns.length > 0) {
      storedLegs = [createLegFromRun(storedRuns[0])];
    }

    const fallbackLeg = storedLegs[0];
    const migratedRuns = fallbackLeg
      ? storedRuns.map(run => run.legId ? run : { ...run, legId: fallbackLeg.id })
      : storedRuns;

    return {
      schemaVersion: 1,
      runs: migratedRuns,
      legs: storedLegs,
      activeLegId: localStorage.getItem('activeLegId') || fallbackLeg?.id || null,
      appSettings: normalizeAppSettings(appSettings),
    };
  };

  const applySharedState = (state: Partial<SharedAppState>) => {
    applyingRemoteState.current = true;
    const nextLegs = Array.isArray(state.legs) ? state.legs : [];
    const nextRuns = Array.isArray(state.runs)
      ? state.runs.map(run => ({ ...run, weight: run.weight || '' }))
      : [];
    const fallbackLeg = nextLegs[0];

    setLegs(nextLegs);
    setRuns(nextRuns);
    setActiveLegId(state.activeLegId || fallbackLeg?.id || null);
    setAppSettings(normalizeAppSettings(state.appSettings));
    window.setTimeout(() => {
      applyingRemoteState.current = false;
    }, 0);
  };

  const persistLocalState = (state: SharedAppState) => {
    saveStorageRuns(state.runs);
    saveStorageLegs(state.legs);
    if (state.activeLegId) {
      localStorage.setItem('activeLegId', state.activeLegId);
    } else {
      localStorage.removeItem('activeLegId');
    }
    localStorage.setItem('app_settings', JSON.stringify(normalizeAppSettings(state.appSettings)));
  };

  // Load local data immediately, then replace it with shared Supabase data when available.
  useEffect(() => {
    const localState = buildLocalState();
    applySharedState(localState);
    setIsLoaded(true);
    persistLocalState(localState);

    const loadRemoteState = async () => {
      if (!supabase) return;

      try {
        setSyncStatus('syncing');
        const { data, error } = await supabase
          .from('app_state')
          .select('state, updated_at')
          .eq('id', SHARED_STATE_ID)
          .maybeSingle();

        if (error) throw error;

        if (data?.state) {
          lastRemoteUpdate.current = data.updated_at;
          applySharedState(data.state as SharedAppState);
          persistLocalState(data.state as SharedAppState);
        } else {
          const { error: seedError } = await supabase
            .from('app_state')
            .upsert({
              id: SHARED_STATE_ID,
              state: localState,
              updated_at: new Date().toISOString(),
            });
          if (seedError) throw seedError;
        }

        setSyncStatus('synced');
      } catch (error) {
        console.error(`Supabase sync load failed: ${describeSyncError(error)}`, error);
        setSyncStatus('error');
      }
    };

    loadRemoteState();
  }, []);

  const sharedState = useMemo<SharedAppState>(() => ({
    schemaVersion: 1,
    runs,
    legs,
    activeLegId,
    appSettings: normalizeAppSettings(appSettings),
  }), [runs, legs, activeLegId, appSettings]);

  // Save locally and to Supabase when app state changes.
  useEffect(() => {
    if (!isLoaded) return;
    if (applyingRemoteState.current) return;

    persistLocalState(sharedState);

    if (!supabase) {
      setSyncStatus('local');
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        const { data, error } = await supabase
          .from('app_state')
          .upsert({
            id: SHARED_STATE_ID,
            state: sharedState,
            updated_at: new Date().toISOString(),
          })
          .select('updated_at')
          .single();

        if (error) throw error;
        lastRemoteUpdate.current = data.updated_at;
        setSyncStatus('synced');
      } catch (error) {
        console.error(`Supabase sync save failed: ${describeSyncError(error)}`, error);
        setSyncStatus('error');
      }
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [sharedState, isLoaded]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-racing-blue-light', appSettings.primaryColor);
    root.style.setProperty('--color-racing-blue-dark', appSettings.secondaryColor);
    root.style.setProperty('--color-racing-red', appSettings.dangerColor);
  }, [appSettings]);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('shared-app-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_state', filter: `id=eq.${SHARED_STATE_ID}` },
        (payload) => {
          const updatedAt = (payload.new as { updated_at?: string } | null)?.updated_at || null;
          if (!updatedAt || updatedAt === lastRemoteUpdate.current) return;

          const state = (payload.new as { state?: SharedAppState } | null)?.state;
          if (!state) return;

          lastRemoteUpdate.current = updatedAt;
          applySharedState(state);
          persistLocalState(state);
          setSyncStatus('synced');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    setCompareIds([]);
    setSelectedRunId(null);
  }, [activeLegId]);

  // --- Derived State ---
  const activeLeg = useMemo(() => legs.find(leg => leg.id === activeLegId) || legs[0] || null, [legs, activeLegId]);
  const scopedRuns = useMemo(() => activeLeg ? runs.filter(run => run.legId === activeLeg.id) : runs, [runs, activeLeg]);
  const sortedRuns = useMemo(() => [...scopedRuns].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [scopedRuns]);
  const fastestRun = useMemo(() => {
    if (scopedRuns.length === 0) return null;
    return [...scopedRuns].sort((a, b) => timeToMs(a.bestLapTime) - timeToMs(b.bestLapTime))[0];
  }, [scopedRuns]);
  
  const selectedRun = useMemo(() => runs.find(r => r.id === selectedRunId), [runs, selectedRunId]);

  // --- Handlers ---
  const handleAddRun = (newRun: Run) => {
    const isNewFastest = !fastestRun || timeToMs(newRun.bestLapTime) < timeToMs(fastestRun.bestLapTime);
    const targetLegId = activeLeg?.id || newRun.legId;
    setRuns(prev => [{ ...newRun, legId: targetLegId, runNumber: newRun.runNumber || prev.filter(run => run.legId === targetLegId).length + 1 }, ...prev]);
    setCurrentView('logbook');
    if (isNewFastest) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#3CB6E3', '#0038A8', '#DE0000', '#ffffff']
      });
    }
  };

  const handleUpdateRun = (updatedRun: Run) => {
    setRuns(prev => prev.map(r => r.id === updatedRun.id ? updatedRun : r));
    setEditingRun(null);
    setCurrentView('logbook');
  };

  const handleDeleteRun = (id: string) => {
    if (confirm('Delete this stint? This cannot be undone.')) {
      setRuns(prev => prev.filter(r => r.id !== id));
      if (selectedRunId === id) setSelectedRunId(null);
      setCompareIds(prev => prev.filter(i => i !== id));
    }
  };

  const handleDuplicateRun = (run: Run) => {
    const duplicated: Run = {
      ...run,
      id: uuidv4(),
      date: new Date().toISOString().split('T')[0],
      legId: run.legId || activeLeg?.id,
      runNumber: (runs.filter(r => (r.legId || activeLeg?.id) === (run.legId || activeLeg?.id)).length || 0) + 1,
      notes: `Duplicated from Run ${run.runNumber} at ${run.trackName}`
    };
    setEditingRun(duplicated);
    setCurrentView('add');
  };

  const openNewLeg = () => {
    setEditingLeg({
      id: uuidv4(),
      name: '',
      trackName: '',
      riderName: '',
      bikeName: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setIsLegModalOpen(true);
  };

  const openEditLeg = () => {
    if (!activeLeg) return;
    setEditingLeg(activeLeg);
    setIsLegModalOpen(true);
  };

  const saveLeg = (leg: RaceLeg) => {
    const normalized = {
      ...leg,
      name: leg.name || `${leg.trackName} Weekend`,
    };
    setLegs(prev => prev.some(item => item.id === normalized.id)
      ? prev.map(item => item.id === normalized.id ? normalized : item)
      : [normalized, ...prev]
    );
    setActiveLegId(normalized.id);
    setEditingLeg(null);
    setIsLegModalOpen(false);
  };

  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 3) return prev; // Limit to 3 comparison
      return [...prev, id];
    });
  };

  const clearSharedData = async () => {
    if (!confirm('Wipe everything on all synced devices? This cannot be undone.')) return;

    const resetState: SharedAppState = {
      schemaVersion: 1,
      runs: [],
      legs: [],
      activeLegId: null,
      appSettings: DEFAULT_APP_SETTINGS,
    };

    applySharedState(resetState);
    localStorage.clear();

    if (supabase) {
      try {
        setSyncStatus('syncing');
        const { data, error } = await supabase
          .from('app_state')
          .upsert({
            id: SHARED_STATE_ID,
            state: resetState,
            updated_at: new Date().toISOString(),
          })
          .select('updated_at')
          .single();

        if (error) throw error;
        lastRemoteUpdate.current = data.updated_at;
        setSyncStatus('synced');
      } catch (error) {
        console.error(`Supabase sync clear failed: ${describeSyncError(error)}`, error);
        setSyncStatus('error');
      }
    }
  };

  // --- Components ---

  const SidebarItem = ({ icon: Icon, label, view, active }: { icon: any, label: string, view: View, active: boolean }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={cn(
        "flex items-center gap-4 px-4 py-4 w-full text-left transition-all duration-200 group relative border-l-4",
        active 
          ? "bg-racing-blue-dark/10 text-white border-racing-blue-light" 
          : "text-gray-500 hover:text-gray-300 hover:bg-white/5 border-transparent"
      )}
    >
      <Icon size={20} className={cn(active ? "text-racing-blue-light" : "opacity-50")} />
      <span className="hidden xl:inline font-bold text-[12px] tracking-widest uppercase">{label}</span>
    </button>
  );

  return (
    <div className="ipad-compact flex flex-col h-screen bg-racing-black-bg text-gray-100 font-sans overflow-hidden">
      {/* TOP NAVIGATION BAR */}
      <header className="grid grid-cols-[auto_minmax(220px,1fr)_auto] items-center gap-3 px-4 lg:px-6 py-2 lg:py-3 border-b border-white/10 bg-racing-header relative z-50">
        <div className="flex items-center min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {appSettings.logoDataUrl && (
              <img src={appSettings.logoDataUrl} alt="App logo" className="h-9 w-9 object-contain shrink-0" />
            )}
            <div className="font-black text-white italic tracking-tighter text-lg lg:text-xl cursor-pointer uppercase" onClick={() => setCurrentView('dashboard')}>RaceLog Pro</div>
          </div>
        </div>

        <div className="min-w-0 border-l border-white/10 pl-4">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Active Race Weekend</span>
          <select
            value={activeLeg?.id || ''}
            onChange={(event) => setActiveLegId(event.target.value)}
            className="mt-1 w-full max-w-[420px] bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs font-bold uppercase text-white focus:outline-none focus:border-racing-blue-light/60"
          >
            {legs.length === 0 && <option value="">Create a leg to begin</option>}
            {legs.map(leg => (
              <option key={leg.id} value={leg.id}>{leg.name} | {leg.trackName}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] uppercase text-gray-500 font-bold">Sync</span>
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest",
              syncStatus === 'synced' && "text-emerald-500",
              syncStatus === 'syncing' && "text-racing-blue-light",
              syncStatus === 'local' && "text-amber-500",
              syncStatus === 'error' && "text-racing-red"
            )}>
              {syncStatus}
            </span>
          </div>
          <div className="hidden md:block h-6 w-[1px] bg-white/10 mx-1"></div>
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[10px] uppercase text-gray-500 font-bold">PB Time</span>
            <span className="text-sm font-mono font-bold text-racing-blue-light">{fastestRun?.bestLapTime || '--:--.---'}</span>
          </div>
          <div className="hidden sm:block h-6 w-[1px] bg-white/10 mx-1"></div>
          <button
            disabled={!activeLeg}
            onClick={openEditLeg}
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-3 lg:px-4 py-2 text-xs font-bold uppercase tracking-widest hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Edit Leg
          </button>
          <button
            onClick={openNewLeg}
            className="bg-zinc-900 border border-racing-blue-light/30 text-white px-3 lg:px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-zinc-800"
          >
            New Leg
          </button>
          <button
            disabled={!activeLeg}
            onClick={() => { setEditingRun(null); setCurrentView('add'); }}
            className="bg-racing-blue-dark hover:bg-racing-blue-dark/80 disabled:opacity-40 disabled:cursor-not-allowed border border-racing-blue-light/30 text-white px-3 lg:px-4 py-2 text-xs font-bold uppercase transition-all active:scale-95"
          >
            + New Stint
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: SIDEBAR NAV */}
        <aside className="bg-racing-header border-r border-white/10 flex flex-col w-16 xl:w-64">
          <nav className="flex-1 py-4 flex flex-col gap-1">
            <SidebarItem icon={LayoutDashboard} label="Dashboard" view="dashboard" active={currentView === 'dashboard'} />
            <SidebarItem icon={BookOpen} label="Stint Logbook" view="logbook" active={currentView === 'logbook'} />
            <SidebarItem icon={GitCompare} label="Comparison" view="compare" active={currentView === 'compare'} />
            
            <SidebarItem icon={Settings} label="Settings" view="settings" active={currentView === 'settings'} />
          </nav>
        </aside>

        {/* CENTER: MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-racing-black-bg">
          <div className="p-3 lg:p-6 relative">
            <AnimatePresence mode="wait">
            {currentView === 'dashboard' && (
              <DashboardView 
                runs={sortedRuns} 
                activeLeg={activeLeg}
                fastestRun={fastestRun} 
                onViewRun={(id) => { setSelectedRunId(id); setCurrentView('details'); }} 
              />
            )}
            {currentView === 'logbook' && (
              <LogbookView 
                runs={sortedRuns} 
                leg={activeLeg}
                onViewRun={(id) => { setSelectedRunId(id); setCurrentView('details'); }} 
                onEdit={(run) => { setEditingRun(run); setCurrentView('add'); }} 
                onDelete={handleDeleteRun}
                onDuplicate={handleDuplicateRun}
              />
            )}
            {currentView === 'add' && (
              <AddRunForm 
                onSave={editingRun?.id && runs.some(r => r.id === editingRun.id) ? handleUpdateRun : handleAddRun} 
                initialData={editingRun} 
                activeLeg={activeLeg}
                nextRunNumber={scopedRuns.length + 1}
                onCancel={() => { setEditingRun(null); setCurrentView('logbook'); }}
              />
            )}
            {currentView === 'details' && selectedRun && (
              <RunDetailView 
                run={selectedRun} 
                onBack={() => setCurrentView('logbook')} 
                onEdit={() => { setEditingRun(selectedRun); setCurrentView('add'); }}
                onDuplicate={() => handleDuplicateRun(selectedRun)}
              />
            )}
            {currentView === 'compare' && (
              <CompareView 
                runs={scopedRuns.filter(r => compareIds.includes(r.id))} 
                allRuns={scopedRuns}
                onAddRun={(id) => toggleCompare(id)}
                onRemoveRun={(id) => toggleCompare(id)}
              />
            )}
            {currentView === 'settings' && (
              <SettingsView settings={appSettings} onSettingsChange={setAppSettings} onClearData={clearSharedData} />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
    {isLegModalOpen && editingLeg && (
      <LegModal
        leg={editingLeg}
        onSave={saveLeg}
        onCancel={() => {
          setEditingLeg(null);
          setIsLegModalOpen(false);
        }}
      />
    )}
    
    {/* FOOTER: STATUS MONITOR */}
    <footer className="h-7 lg:h-8 bg-racing-blue-dark flex items-center justify-between px-4 lg:px-6 text-[10px] font-bold text-white uppercase shrink-0 border-t border-racing-blue-light/20">
      <div className="flex gap-8">
        <span>SYSTEMS: OPTIMAL</span>
        <span>TRACKSIDE LOG: ACTIVE</span>
        <span>SYNC: ACTIVE</span>
      </div>
      <div className="flex gap-4 font-mono">
        <span>V 2.6.5-STABLE</span>
        <span className="opacity-80 uppercase">{formatDisplayDate(new Date().toISOString().split('T')[0])}</span>
      </div>
    </footer>
  </div>
);
}

// --- Sub-Views ---

function LegModal({ leg, onSave, onCancel }: { leg: RaceLeg, onSave: (leg: RaceLeg) => void, onCancel: () => void }) {
  const [draft, setDraft] = useState<RaceLeg>(leg);

  const save = () => {
    if (!draft.trackName || !draft.riderName || !draft.bikeName) {
      alert('Track, rider, and bike are required for a leg.');
      return;
    }
    onSave(draft);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 w-full max-w-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black italic uppercase tracking-tighter">Race Weekend Leg</h2>
            <p className="text-xs text-zinc-500 uppercase tracking-widest">Base details inherited by new stints</p>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-white"><Zap size={20} className="rotate-45" /></button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <InputGroup label="Leg Name" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="e.g. Clark International Speedway Round 2" />
          </div>
          <InputGroup label="Track Name" value={draft.trackName} onChange={v => setDraft({ ...draft, trackName: v })} placeholder="Track / Circuit" required />
          <InputGroup label="Rider" value={draft.riderName} onChange={v => setDraft({ ...draft, riderName: v })} placeholder="Rider name" required />
          <InputGroup label="Bike Model" value={draft.bikeName} onChange={v => setDraft({ ...draft, bikeName: v })} placeholder="Bike model" required />
          <div className="grid grid-cols-2 gap-4">
            <InputGroup label="Start Date" type="date" value={draft.startDate} onChange={v => setDraft({ ...draft, startDate: v })} />
            <InputGroup label="End Date" type="date" value={draft.endDate} onChange={v => setDraft({ ...draft, endDate: v })} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Leg Notes</label>
            <textarea
              value={draft.notes}
              onChange={event => setDraft({ ...draft, notes: event.target.value })}
              className="mt-1.5 w-full bg-racing-black-bg border border-white/5 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-racing-blue-light/50 transition-all text-gray-100 min-h-[90px]"
              placeholder="Weekend goals, tire allocation, baseline plan."
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-3">
          <button onClick={onCancel} className="bg-zinc-900 text-zinc-400 px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:text-white">Cancel</button>
          <button onClick={save} className="bg-racing-blue-dark text-white px-6 py-2.5 text-xs font-bold uppercase tracking-widest border border-racing-blue-light/30 hover:bg-racing-blue-dark/80">Save Leg</button>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ runs, activeLeg, fastestRun, onViewRun }: { 
  runs: Run[], 
  activeLeg: RaceLeg | null,
  fastestRun: Run | null, 
  onViewRun: (id: string) => void, 
}) {
  const latestRun = runs[0];
  
  const recentLapsData = useMemo(() => {
    const recent = [...runs]
      .sort((a, b) => a.runNumber - b.runNumber)
      .slice(-10);
    const bestMs = recent.length ? Math.min(...recent.map(r => timeToMs(r.bestLapTime))) : 0;
    return recent.map(r => ({
      name: `R${r.runNumber}`,
      time: (timeToMs(r.bestLapTime) - bestMs) / 1000,
      rawTime: r.bestLapTime,
      deltaMs: timeToMs(r.bestLapTime) - bestMs,
      track: r.trackName
    }));
  }, [runs]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }}
      className="space-y-3 lg:space-y-8"
    >
      <header>
        <div className="bg-racing-panel border border-white/10 p-4 lg:p-5 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-gray-500 font-black mb-1">Race Weekend Leg</p>
          <h2 className="text-xl lg:text-3xl font-black tracking-tighter text-white leading-tight break-words">{activeLeg?.name || 'Race Weekend'}</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-5">
            <LegFact label="Track" value={activeLeg?.trackName || '--'} />
            <LegFact label="Rider" value={activeLeg?.riderName || '--'} />
            <LegFact label="Bike" value={activeLeg?.bikeName || '--'} />
          </div>
        </div>
      </header>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-6">
        <StatCard 
          label="Latest Stint" 
          value={latestRun?.bestLapTime || '--:--.---'} 
          sub={latestRun ? `Run ${latestRun.runNumber} // ${latestRun.sessionType}` : 'No stints in this leg'} 
          icon={Clock} 
          trend={latestRun && runs[1] ? timeToMs(latestRun.bestLapTime) < timeToMs(runs[1].bestLapTime) : null}
          color="rose"
        />
        <StatCard 
          label="Personal Best" 
          value={fastestRun?.bestLapTime || '--:--.---'} 
          sub={fastestRun ? `Run ${fastestRun.runNumber} // ${fastestRun.sessionType}` : 'No data'} 
          icon={Trophy} 
          color="amber"
          glow
          className="sm:col-span-1"
        />
        <StatCard 
          label="Total Runs" 
          value={runs.length.toString()} 
          sub="Inside selected leg" 
          icon={History} 
          color="blue"
          className="sm:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 xl:gap-8">
        {/* Lap Trend Chart */}
        <div className="lg:col-span-2 bg-racing-panel border border-white/5 rounded-none p-3 lg:p-4 xl:p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 lg:mb-8">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-6 bg-racing-blue-light" />
              <h3 className="font-bold text-base lg:text-xl uppercase tracking-tighter italic">Lap Time Trends</h3>
            </div>
            <div className="text-[10px] text-gray-500 font-mono font-bold tracking-widest uppercase">LATEST 10 RUNS</div>
          </div>
          <div className="h-[130px] xl:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={recentLapsData}>
                <defs>
                  <linearGradient id="colorTime" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-racing-blue-light)" stopOpacity={0.22}/>
                    <stop offset="95%" stopColor="var(--color-racing-blue-light)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                <XAxis dataKey="name" stroke="#555" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis
                  width={52}
                  stroke="#555"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  domain={([dataMin, dataMax]) => [Math.max(0, dataMin - 0.05), dataMax + 0.1]}
                  tickFormatter={(val: number) => `+${val.toFixed(3)}s`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '0px' }}
                  labelStyle={{ color: 'var(--color-racing-blue-light)', fontWeight: 'bold' }}
                  formatter={(val: number, _name, item: any) => [`${item.payload.rawTime} (${val === 0 ? 'PB' : `+${val.toFixed(3)}s`})`, 'Best Lap']}
                />
                <Area type="monotone" dataKey="time" stroke="var(--color-racing-blue-light)" strokeWidth={3} fillOpacity={1} fill="url(#colorTime)" dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Setup Summary Card */}
        <div className="bg-racing-panel border border-white/5 rounded-none p-3 lg:p-4 xl:p-6 shadow-xl relative overflow-hidden flex flex-col">
          <div className="absolute top-0 right-0 w-32 h-32 bg-racing-blue-light/5 blur-3xl -mr-16 -mt-16" />
          <div className="flex items-center gap-3 mb-3 lg:mb-6 relative z-10">
            <Zap size={18} className="text-racing-blue-light" />
            <h3 className="font-bold text-base lg:text-xl uppercase tracking-tighter italic">Active Setup</h3>
          </div>
          
          {latestRun ? (
            <div className="grid grid-cols-1 gap-2 lg:gap-3 flex-1 relative z-10">
              <SetupMiniCard label="Tire Pressure" value={`${latestRun.setup.tirePressure.front} / ${latestRun.setup.tirePressure.rear} ${latestRun.setup.tirePressure.unit}`} icon={Gauge} />
              <SetupMiniCard label="Electronics" value={`TC:${latestRun.setup.electronics.tc} ABS:${latestRun.setup.electronics.abs} PW:${latestRun.setup.electronics.powerMode}`} icon={Zap} />
              <SetupMiniCard label="Gearing" value={`${latestRun.setup.gearing.front}/${latestRun.setup.gearing.rear}`} icon={Navigation} />
              
              <div className="hidden xl:block mt-8 pt-6 border-t border-white/5">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Recent Feedback</p>
                <p className="text-xs italic text-gray-400 line-clamp-2 leading-relaxed">"{latestRun.riderComment}"</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {latestRun.feedbackTags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[9px] bg-racing-blue-light/10 text-racing-blue-light px-2 py-0.5 border border-racing-blue-light/20 font-bold uppercase">{tag}</span>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => onViewRun(latestRun.id)}
                className="w-full mt-auto flex items-center justify-between group text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors h-9 lg:h-10 px-2"
              >
                Full Setup Sheet
                <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 italic">
              No active stints found.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function LogbookView({ runs, leg, onViewRun, onEdit, onDelete, onDuplicate }: { 
  runs: Run[], 
  leg: RaceLeg | null,
  onViewRun: (id: string) => void, 
  onEdit: (run: Run) => void, 
  onDelete: (id: string) => void, 
  onDuplicate: (run: Run) => void
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.98 }}
      className="space-y-8"
    >
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl lg:text-4xl font-black italic tracking-tighter uppercase">Stint Logbook</h2>
          <p className="text-zinc-500 font-medium tracking-wide">{leg ? `${leg.name} // ${leg.trackName} // ${leg.riderName}` : 'Select an active race weekend in the header'}</p>
        </div>
      </header>

      <div className="bg-racing-panel border border-white/5 overflow-hidden">
        <div className="hidden md:grid grid-cols-[56px_100px_minmax(0,1fr)_118px_64px_86px_122px_152px] bg-zinc-950/70 border-b border-zinc-800 text-[10px] text-zinc-500 font-black uppercase tracking-widest">
          <div className="px-4 py-3">Run</div>
          <div className="px-4 py-3">Type</div>
          <div className="px-4 py-3">Track / Bike</div>
          <div className="px-4 py-3">Best Lap</div>
          <div className="px-4 py-3">Laps</div>
          <div className="px-4 py-3">Weight</div>
          <div className="px-4 py-3">Setup</div>
          <div className="px-4 py-3 text-right">Actions</div>
        </div>

        <div className="divide-y divide-zinc-800/80">
          {runs.map((run) => (
            <div
              key={run.id}
              role="button"
              tabIndex={0}
              onClick={() => onViewRun(run.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onViewRun(run.id);
                }
              }}
              className={cn(
                "grid grid-cols-1 md:grid-cols-[56px_100px_minmax(0,1fr)_118px_64px_86px_122px_152px] items-center gap-0 bg-racing-panel hover:bg-white/[0.035] active:bg-racing-blue-dark/10 transition-colors cursor-pointer touch-manipulation"
              )}
            >
              <div className="px-4 pt-4 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Run</div>
                <span className="font-mono text-racing-blue-light font-black text-lg">R{run.runNumber}</span>
              </div>

              <div className="px-4 py-2 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Type</div>
                <SessionBadge type={run.sessionType} />
              </div>

              <div className="px-4 py-2 md:py-4 min-w-0">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Track / Bike</div>
                <div className="font-bold text-white text-sm lg:text-base truncate">{run.trackName}</div>
                <div className="text-[11px] text-zinc-500 uppercase tracking-widest truncate">{run.bikeName} | {run.tireBrand || '--'}</div>
              </div>

              <div className="px-4 py-2 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Best Lap</div>
                <div className="font-mono font-black text-white text-lg">{run.bestLapTime}</div>
                <div className="text-[10px] text-zinc-500 font-mono">AVG {run.avgLapTime}</div>
              </div>

              <div className="px-4 py-2 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Laps</div>
                <span className="font-mono font-bold text-zinc-300">{run.lapsCompleted}</span>
              </div>

              <div className="px-4 py-2 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Weight</div>
                <span className="font-mono font-bold text-zinc-300">{run.weight || '--'}</span>
              </div>

              <div className="px-4 py-2 md:py-4">
                <div className="md:hidden text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-1">Setup</div>
                <div className="font-mono text-xs text-zinc-300">{run.setup.tirePressure.front}/{run.setup.tirePressure.rear} {run.setup.tirePressure.unit}</div>
                <div className="font-mono text-[10px] text-zinc-500">TC {run.setup.electronics.tc} | {run.setup.gearing.front}/{run.setup.gearing.rear}</div>
              </div>

              <div
                className="px-4 pb-4 pt-2 md:py-3 flex items-center md:justify-end gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                <TouchIconButton label="Edit stint" onClick={() => onEdit(run)} icon={Edit} />
                <TouchIconButton label="Duplicate stint" onClick={() => onDuplicate(run)} icon={Copy} />
                <TouchIconButton label="Delete stint" onClick={() => onDelete(run.id)} icon={Trash2} tone="danger" />
              </div>
            </div>
          ))}
        </div>

        {runs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-zinc-900/30 border-2 border-dashed border-zinc-800 rounded-none">
            <BookOpen size={48} className="text-zinc-700 mb-4" />
            <p className="text-zinc-500 italic px-6 text-center">Archive empty. Log your first stint to start building your setup database.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AddRunForm({ onSave, initialData, onCancel, activeLeg, nextRunNumber }: { onSave: (run: Run) => void, initialData?: Run | null, onCancel: () => void, activeLeg: RaceLeg | null, nextRunNumber: number }) {
  const [formData, setFormData] = useState<Partial<Run>>(initialData || {
    id: uuidv4(),
    legId: activeLeg?.id,
    date: new Date().toISOString().split('T')[0],
    runNumber: nextRunNumber,
    trackName: activeLeg?.trackName || '',
    sessionType: 'Practice',
    weather: 'Sunny',
    trackCondition: 'Dry',
    weight: '',
    riderName: activeLeg?.riderName || '',
    bikeName: activeLeg?.bikeName || '',
    tireBrand: '',
    notes: '',
    bestLapTime: '00:00.000',
    avgLapTime: '00:00.000',
    lapsCompleted: 0,
    lapTimes: [],
    setup: INITIAL_SETUP,
    feedbackTags: [],
    riderComment: '',
    confidenceRating: 3,
    gripRating: 3,
    stabilityRating: 3,
    brakingConfidence: 3,
    nextRunPlan: ''
  });

  const [activeTab, setActiveTab] = useState<'general' | 'setup' | 'feedback'>('general');
  const [setupTab, setSetupTab] = useState<'basics' | 'suspension'>('basics');

  const updateSetup = (category: keyof Setup, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      setup: {
        ...prev.setup!,
        [category]: typeof prev.setup![category] === 'object' 
          ? { ...prev.setup![category], [field]: value }
          : value
      }
    }));
  };

  const handleSave = () => {
    if (!activeLeg && !formData.legId) {
      alert('Create or select a race weekend leg before logging a stint.');
      return;
    }
    if (!formData.trackName || !formData.bestLapTime) {
      alert('Please fill in required fields (Track and Best Lap)');
      return;
    }
    onSave({
      ...formData,
      legId: formData.legId || activeLeg?.id,
      trackName: activeLeg?.trackName || formData.trackName,
      riderName: activeLeg?.riderName || formData.riderName,
      bikeName: activeLeg?.bikeName || formData.bikeName,
    } as Run);
  };

  if (!activeLeg && !initialData) {
    return (
      <div className="bg-racing-panel border border-white/5 p-8">
        <h2 className="text-3xl font-black italic uppercase tracking-tighter mb-2">Create a Leg First</h2>
        <p className="text-zinc-500">A stint belongs to a race weekend leg. Use `New Leg` in the top bar, then log stints inside it.</p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4 lg:space-y-8"
    >
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 lg:gap-4">
        <div>
          <h2 className="text-4xl font-black italic tracking-tighter uppercase">{initialData?.id ? 'Edit Stint' : 'Log New Stint'}</h2>
          <p className="text-zinc-500 font-medium tracking-wide text-sm leading-snug max-w-3xl">
            {activeLeg ? `${activeLeg.name} // ${activeLeg.trackName} // ${activeLeg.riderName} // ${activeLeg.bikeName}` : 'Record setup data and technical feedback'}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="bg-zinc-800 text-zinc-400 px-4 lg:px-6 py-2.5 lg:py-3 rounded-none font-bold uppercase tracking-widest text-xs lg:text-sm hover:bg-zinc-700 transition-all">Cancel</button>
          <button onClick={handleSave} className="bg-racing-blue-dark text-white px-6 lg:px-8 py-2.5 lg:py-3 rounded-none font-bold uppercase tracking-widest text-xs lg:text-sm border border-racing-blue-light/30 hover:bg-racing-blue-dark/80 transition-all shadow-lg">Save Session</button>
        </div>
      </header>

      <div className="flex border-b border-zinc-800 overflow-x-auto no-scrollbar">
        <button 
          onClick={() => setActiveTab('general')}
          className={cn("px-5 lg:px-8 py-3 lg:py-4 text-[11px] lg:text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap", activeTab === 'general' ? "border-racing-blue-light text-racing-blue-light bg-racing-blue-light/5" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          General Data
        </button>
        <button 
          onClick={() => setActiveTab('setup')}
          className={cn("px-5 lg:px-8 py-3 lg:py-4 text-[11px] lg:text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap", activeTab === 'setup' ? "border-racing-blue-light text-racing-blue-light bg-racing-blue-light/5" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          Bike Setup
        </button>
        <button 
          onClick={() => setActiveTab('feedback')}
          className={cn("px-5 lg:px-8 py-3 lg:py-4 text-[11px] lg:text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap", activeTab === 'feedback' ? "border-racing-blue-light text-racing-blue-light bg-racing-blue-light/5" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          Rider Feel
        </button>
      </div>

      <div className="compact-panel bg-racing-panel border border-white/5 p-4 lg:p-8 rounded-none shadow-xl">
        {activeTab === 'general' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-8 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="space-y-3 lg:space-y-6">
                <div className="grid grid-cols-1 gap-4 bg-zinc-950/50 border border-zinc-800 p-4">
                  <div>
                    <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Race Weekend Leg</p>
                    <p className="text-sm font-bold text-white">{activeLeg?.name || 'Unassigned'}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <LegFact label="Track" value={activeLeg?.trackName || formData.trackName || '--'} />
                    <LegFact label="Rider" value={activeLeg?.riderName || formData.riderName || '--'} />
                    <LegFact label="Bike" value={activeLeg?.bikeName || formData.bikeName || '--'} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <DateGroup label="Date" value={formData.date!} onChange={v => setFormData({...formData, date: v})} />
                  <InputGroup label="Run Number" type="number" value={formData.runNumber!.toString()} onChange={v => setFormData({...formData, runNumber: parseInt(v)})} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <SelectGroup label="Session Type" options={['Practice', 'Qualifying', 'Race', 'Test']} value={formData.sessionType!} onChange={v => setFormData({...formData, sessionType: v as SessionType})} />
                  <InputGroup label="Weight" value={formData.weight!} onChange={v => setFormData({...formData, weight: v})} placeholder="64 kg" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup label="Tires Used" value={formData.tireBrand!} onChange={v => setFormData({...formData, tireBrand: v})} />
                  <SelectGroup label="Weather" options={WEATHER_OPTIONS} value={formData.weather!} onChange={v => setFormData({...formData, weather: v})} />
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <SelectGroup label="Track Condition" options={TRACK_CONDITION_OPTIONS} value={formData.trackCondition!} onChange={v => setFormData({...formData, trackCondition: v})} />
                </div>
             </div>
             <div className="space-y-3 lg:space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup label="Best Lap Time" value={formData.bestLapTime!} onChange={v => setFormData({...formData, bestLapTime: v})} placeholder="01:52.450" fontMono required />
                  <InputGroup label="Avg Lap Time" value={formData.avgLapTime!} onChange={v => setFormData({...formData, avgLapTime: v})} placeholder="01:53.200" fontMono />
                </div>
                <InputGroup label="Laps Completed" type="number" value={formData.lapsCompleted!.toString()} onChange={v => setFormData({...formData, lapsCompleted: parseInt(v)})} />
                <div className="pt-2">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 block">Session Notes</label>
                  <textarea 
                    value={formData.notes} 
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-racing-blue-light min-h-[72px] lg:min-h-[100px]"
                    placeholder="General observations, traffic notes, etc."
                  />
                </div>
             </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-4 lg:space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex border border-zinc-800 bg-zinc-950 w-fit">
              {[
                ['basics', 'Pressure / Drive'],
                ['suspension', 'Suspension']
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSetupTab(id as 'basics' | 'suspension')}
                  className={cn(
                    "px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors",
                    setupTab === id ? "bg-racing-blue-dark text-white" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {setupTab === 'basics' && (
            <div className="space-y-5 lg:space-y-10">
            {/* Tire Pressure */}
            <section>
              <h3 className="flex items-center gap-2 font-bold text-racing-blue-light uppercase tracking-widest text-xs mb-3 lg:mb-6">
                <Gauge size={16} /> Tire Pressure
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-6">
                <InputGroup label="Front Pressure" step="0.1" value={formData.setup?.tirePressure.front.toString()!} onChange={v => updateSetup('tirePressure', 'front', parseFloat(v))} />
                <InputGroup label="Rear Pressure" step="0.1" value={formData.setup?.tirePressure.rear.toString()!} onChange={v => updateSetup('tirePressure', 'rear', parseFloat(v))} />
                <SelectGroup label="Unit" options={['PSI', 'BAR']} value={formData.setup?.tirePressure.unit!} onChange={v => updateSetup('tirePressure', 'unit', v)} />
              </div>
            </section>

            {/* Gearing and Electronics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-10">
               <section>
                  <h3 className="flex items-center gap-2 font-bold text-racing-blue-light uppercase tracking-widest text-xs mb-3 lg:mb-6">
                    <Navigation size={16} /> Gearing
                  </h3>
                  <div className="grid grid-cols-2 gap-3 lg:gap-4">
                    <InputGroup label="Front Sprocket" type="number" value={formData.setup?.gearing.front.toString()!} onChange={v => updateSetup('gearing', 'front', parseInt(v))} />
                    <InputGroup label="Rear Sprocket" type="number" value={formData.setup?.gearing.rear.toString()!} onChange={v => updateSetup('gearing', 'rear', parseInt(v))} />
                  </div>
                  <div className="mt-3 lg:mt-4 p-3 lg:p-4 bg-zinc-950 rounded-none border border-zinc-800">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Final Drive Ratio</p>
                    <p className="text-xl font-mono font-bold text-white">{(formData.setup!.gearing.rear / formData.setup!.gearing.front).toFixed(4)}</p>
                  </div>
               </section>
               <section>
                  <h3 className="flex items-center gap-2 font-bold text-racing-blue-light uppercase tracking-widest text-xs mb-3 lg:mb-6">
                    <Zap size={16} /> Electronics
                  </h3>
                  <div className="grid grid-cols-3 gap-3 lg:gap-4">
                    <InputGroup label="TC" value={formData.setup?.electronics.tc!} onChange={v => updateSetup('electronics', 'tc', v)} />
                    <InputGroup label="ABS" value={formData.setup?.electronics.abs!} onChange={v => updateSetup('electronics', 'abs', v)} />
                    <InputGroup label="Power" value={formData.setup?.electronics.powerMode!} onChange={v => updateSetup('electronics', 'powerMode', v)} />
                  </div>
               </section>
            </div>
            </div>
            )}

            {/* Suspension */}
            {setupTab === 'suspension' && (
            <section>
              <h3 className="flex items-center gap-2 font-bold text-racing-blue-light uppercase tracking-widest text-xs mb-3 lg:mb-6">
                <Activity size={16} /> Suspension Settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-10">
                <div className="space-y-3 lg:space-y-4 bg-zinc-950/30 p-4 lg:p-6 rounded-none border border-zinc-800/50">
                  <h4 className="text-[10px] text-zinc-400 font-bold uppercase tracking-[0.2em] mb-3 lg:mb-4">Front (Forks)</h4>
                  <div className="grid grid-cols-2 gap-3 lg:gap-4">
                    <InputGroup label="Spring Rate" value={formData.setup?.frontSuspension.springRate!} onChange={v => updateSetup('frontSuspension', 'springRate', v)} />
                    <InputGroup label="Preload" value={formData.setup?.frontSuspension.preload!} onChange={v => updateSetup('frontSuspension', 'preload', v)} />
                    <InputGroup label="Compression" value={formData.setup?.frontSuspension.compression!} onChange={v => updateSetup('frontSuspension', 'compression', v)} />
                    <InputGroup label="Rebound" value={formData.setup?.frontSuspension.rebound!} onChange={v => updateSetup('frontSuspension', 'rebound', v)} />
                    <InputGroup label="Height (mm)" value={formData.setup?.frontSuspension.forkHeight!} onChange={v => updateSetup('frontSuspension', 'forkHeight', v)} />
                  </div>
                </div>
                <div className="space-y-3 lg:space-y-4 bg-zinc-950/30 p-4 lg:p-6 rounded-none border border-zinc-800/50">
                  <h4 className="text-[10px] text-zinc-400 font-bold uppercase tracking-[0.2em] mb-3 lg:mb-4">Rear (Shock)</h4>
                  <div className="grid grid-cols-2 gap-3 lg:gap-4">
                    <InputGroup label="Spring Rate" value={formData.setup?.rearSuspension.springRate!} onChange={v => updateSetup('rearSuspension', 'springRate', v)} />
                    <InputGroup label="Preload" value={formData.setup?.rearSuspension.preload!} onChange={v => updateSetup('rearSuspension', 'preload', v)} />
                    <InputGroup label="Compression" value={formData.setup?.rearSuspension.compression!} onChange={v => updateSetup('rearSuspension', 'compression', v)} />
                    <InputGroup label="Rebound" value={formData.setup?.rearSuspension.rebound!} onChange={v => updateSetup('rearSuspension', 'rebound', v)} />
                    <InputGroup label="Ride Height" value={formData.setup?.rearSuspension.rideHeight!} onChange={v => updateSetup('rearSuspension', 'rideHeight', v)} />
                    <InputGroup label="Sag (mm)" value={formData.setup?.rearSuspension.sag!} onChange={v => updateSetup('rearSuspension', 'sag', v)} />
                  </div>
                </div>
              </div>
            </section>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-4 lg:space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <section>
              <h3 className="font-bold text-racing-blue-light uppercase tracking-widest text-xs mb-3 lg:mb-6">Quick Feedback Tags</h3>
              <div className="flex flex-wrap gap-1.5 lg:gap-2">
                {FEEDBACK_TAGS.map(tag => (
                  <button
                    key={tag}
                    onClick={() => {
                      const tags = formData.feedbackTags || [];
                      setFormData({
                        ...formData,
                        feedbackTags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
                      });
                    }}
                    className={cn(
                      "px-3 lg:px-4 py-1.5 lg:py-2 rounded-none text-[10px] lg:text-xs font-bold uppercase tracking-wide transition-all border",
                      formData.feedbackTags?.includes(tag) 
                        ? "bg-racing-blue-dark border-racing-blue-light text-white shadow-lg shadow-racing-blue-dark/20" 
                        : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-8">
               <div className="space-y-4 lg:space-y-6">
                  <h3 className="font-bold text-rose-500 uppercase tracking-widest text-xs mb-2">Performance Metrics (1-5)</h3>
                  <RangeGroup label="Rider Confidence" value={formData.confidenceRating!} onChange={v => setFormData({...formData, confidenceRating: v})} />
                  <RangeGroup label="Mechanical Grip" value={formData.gripRating!} onChange={v => setFormData({...formData, gripRating: v})} />
                  <RangeGroup label="Chassis Stability" value={formData.stabilityRating!} onChange={v => setFormData({...formData, stabilityRating: v})} />
                  <RangeGroup label="Braking Confidence" value={formData.brakingConfidence!} onChange={v => setFormData({...formData, brakingConfidence: v})} />
               </div>
               <div className="space-y-4 lg:space-y-6 flex flex-col">
                  <h3 className="font-bold text-rose-500 uppercase tracking-widest text-xs">Detailed Feedback</h3>
                  <textarea 
                    value={formData.riderComment} 
                    onChange={e => setFormData({...formData, riderComment: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-rose-500 flex-1 min-h-[96px] lg:min-h-[150px]"
                    placeholder="How did the bike feel through different sections? Be specific about entry, apex, and exit."
                  />
                  <div className="mt-4">
                    <h3 className="font-bold text-zinc-400 uppercase tracking-widest text-[10px] mb-2">Plan for Next Stint</h3>
                    <textarea 
                      value={formData.nextRunPlan} 
                      onChange={e => setFormData({...formData, nextRunPlan: e.target.value})}
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-xs italic focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[72px] lg:min-h-0"
                      placeholder="e.g. Reduce front preload by 1 turn, try 1 PSI lower in rear."
                    />
                  </div>
               </div>
            </section>
          </div>
        )}
      </div>
      
      <div className="flex justify-end p-4">
         <button onClick={handleSave} className="bg-racing-blue-dark text-white px-12 py-4 rounded-none font-black italic uppercase tracking-tighter text-xl border-2 border-racing-blue-light/50 hover:bg-racing-blue-dark/80 transition-all shadow-[0_15px_30px_rgba(0,56,168,0.4)] hover:scale-105 active:scale-95">Complete Logging</button>
      </div>
    </motion.div>
  );
}

function RunDetailView({ run, onBack, onEdit, onDuplicate }: { run: Run, onBack: () => void, onEdit: () => void, onDuplicate: () => void }) {
  const [detailTab, setDetailTab] = useState<'overview' | 'setup' | 'feedback'>('overview');

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="space-y-4 lg:space-y-8"
    >
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 lg:gap-6">
        <div className="flex items-start gap-4 lg:gap-6 min-w-0">
          <button onClick={onBack} className="p-2.5 lg:p-3 bg-racing-panel border border-white/5 rounded-none text-gray-500 hover:text-white transition-all shrink-0"><ChevronDown className="rotate-90" /></button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-1 min-w-0">
              <h2 className="text-2xl lg:text-4xl font-black italic tracking-tighter uppercase leading-[0.95] break-words min-w-0">
                {run.trackName} <span className="text-racing-blue-light">R{run.runNumber}</span>
              </h2>
              <div className="shrink-0">
                <SessionBadge type={run.sessionType} />
              </div>
            </div>
            <p className="text-zinc-500 text-sm font-semibold tracking-wide leading-snug">{formatDisplayDate(run.date)} // {run.bikeName}</p>
          </div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button onClick={onDuplicate} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 px-4 lg:px-5 py-2.5 rounded-none text-xs font-bold uppercase tracking-widest hover:text-white transition-all"><Copy size={16}/> Duplicate</button>
          <button onClick={onEdit} className="flex items-center gap-2 bg-racing-blue-dark text-white px-4 lg:px-6 py-2.5 rounded-none text-xs font-bold uppercase tracking-widest border border-racing-blue-light/30 hover:bg-racing-blue-dark/80 transition-all shadow-lg"><Edit size={16}/> Edit Entry</button>
        </div>
      </header>

      <div className="flex border-b border-zinc-800 overflow-x-auto no-scrollbar">
        {[
          ['overview', 'Overview'],
          ['setup', 'Setup'],
          ['feedback', 'Feedback']
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setDetailTab(id as 'overview' | 'setup' | 'feedback')}
            className={cn(
              "px-5 lg:px-8 py-3 lg:py-4 text-[11px] lg:text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap",
              detailTab === id ? "border-racing-blue-light text-racing-blue-light bg-racing-blue-light/5" : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {detailTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          <div className="compact-card lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-none p-4 lg:p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5"><Clock size={120} /></div>
            <h3 className="text-xs font-bold text-racing-blue-light uppercase tracking-widest mb-4 flex items-center gap-2">
              <History size={14} /> Performance
            </h3>
            <div className="grid grid-cols-3 gap-4 lg:gap-8">
              <div>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Best Lap</p>
                <p className="text-2xl lg:text-3xl font-black font-mono tracking-tighter text-white">{run.bestLapTime}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Average</p>
                <p className="text-2xl lg:text-3xl font-black font-mono tracking-tighter text-zinc-400">{run.avgLapTime}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Laps</p>
                <p className="text-2xl lg:text-3xl font-black font-mono tracking-tighter text-zinc-400">{run.lapsCompleted}</p>
              </div>
            </div>
          </div>
          <div className="compact-card bg-zinc-900 border border-zinc-800 rounded-none p-4 lg:p-6">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Wind size={14} /> Conditions
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <DetailFact label="Weather" value={run.weather} />
              <DetailFact label="Track" value={run.trackCondition} />
              <DetailFact label="Weight" value={run.weight || '--'} />
              <DetailFact label="Tire" value={run.tireBrand || '--'} />
            </div>
          </div>
        </div>
      )}

      {detailTab === 'setup' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
          <div className="bg-zinc-950 px-4 lg:px-8 py-3 lg:py-5 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="font-bold text-base lg:text-lg uppercase tracking-tighter flex items-center gap-2 italic">
              <Settings size={18} className="text-racing-blue-light" /> Engineering Setup
            </h3>
            <span className="text-[10px] font-mono text-zinc-600">SPEC_ID: {run.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-zinc-800">
            <SetupSection title="Tires" icon={Gauge}>
              <SetupRow label="Front" value={run.setup.tirePressure.front} unit={run.setup.tirePressure.unit} />
              <SetupRow label="Rear" value={run.setup.tirePressure.rear} unit={run.setup.tirePressure.unit} />
              <SetupRow label="Fuel" value={`${run.setup.fuelLiters}L`} />
            </SetupSection>
            <SetupSection title="Front" icon={ArrowDown}>
              <SetupRow label="Spring" value={run.setup.frontSuspension.springRate} />
              <SetupRow label="Preload" value={run.setup.frontSuspension.preload} />
              <SetupRow label="Comp" value={run.setup.frontSuspension.compression} />
              <SetupRow label="Reb" value={run.setup.frontSuspension.rebound} />
            </SetupSection>
            <SetupSection title="Rear" icon={ArrowUp}>
              <SetupRow label="Spring" value={run.setup.rearSuspension.springRate} />
              <SetupRow label="Preload" value={run.setup.rearSuspension.preload} />
              <SetupRow label="Comp" value={run.setup.rearSuspension.compression} />
              <SetupRow label="Reb" value={run.setup.rearSuspension.rebound} />
            </SetupSection>
            <SetupSection title="Drivetrain" icon={Navigation}>
              <SetupRow label="Gearing" value={`${run.setup.gearing.front}/${run.setup.gearing.rear}`} />
              <SetupRow label="Final Drive" value={run.setup.gearing.finalDrive.toFixed(3)} />
              <SetupRow label="TC/ABS" value={`${run.setup.electronics.tc}/${run.setup.electronics.abs}`} />
            </SetupSection>
          </div>
        </div>
      )}

      {detailTab === 'feedback' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
          <div className="lg:col-span-3 bg-[#0f0f0f] border border-zinc-800 rounded-none p-4 lg:p-6">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Activity size={16} /> Rider Feedback
            </h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {run.feedbackTags.map(tag => (
                <span key={tag} className="px-3 py-1 bg-racing-blue-dark/10 text-racing-blue-light border border-racing-blue-light/20 rounded-none text-[10px] font-bold uppercase tracking-wide">{tag}</span>
              ))}
            </div>
            <p className="text-base lg:text-xl font-medium text-zinc-200 leading-relaxed italic">
              "{run.riderComment || 'No detailed feedback provided for this stint.'}"
            </p>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            <div className="col-span-2 bg-racing-blue-dark/5 border border-racing-blue-light/20 rounded-none p-4 lg:p-6">
              <h3 className="text-xs font-bold text-racing-blue-light uppercase tracking-widest mb-4 flex items-center gap-2">
                <Zap size={16} /> Next Plan
              </h3>
              <p className="text-zinc-300 leading-relaxed font-mono text-sm whitespace-pre-wrap">
                {run.nextRunPlan || 'Finalize next steps based on rider feedback and setup changes.'}
              </p>
            </div>
            <RatingCircle label="Confidence" value={run.confidenceRating} />
            <RatingCircle label="Grip" value={run.gripRating} />
            <RatingCircle label="Stability" value={run.stabilityRating} />
            <RatingCircle label="Braking" value={run.brakingConfidence} />
          </div>
        </div>
      )}

    </motion.div>
  );
}

function CompareView({ runs, allRuns, onAddRun, onRemoveRun }: { runs: Run[], allRuns: Run[], onAddRun: (id: string) => void, onRemoveRun: (id: string) => void }) {
  const selectedIds = new Set(runs.map(run => run.id));
  const compareCandidates = useMemo(() => [...allRuns].sort((a, b) => a.runNumber - b.runNumber), [allRuns]);
  const bestLapMs = runs.length ? Math.min(...runs.map(r => timeToMs(r.bestLapTime))) : 0;

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.98 }}
      className="space-y-6 lg:space-y-8"
    >
      <header>
        <div>
          <h2 className="text-3xl lg:text-4xl font-black italic tracking-tighter uppercase">Setup Contrast</h2>
          <p className="text-zinc-500 font-medium tracking-wide">Select up to three stints from the active race weekend and compare pace, setup, conditions, and rider feel.</p>
        </div>
      </header>

      <section className="bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
        <div className="px-4 lg:px-6 py-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-racing-blue-light uppercase tracking-[0.3em]">Stint Selection</h3>
            <p className="text-xs text-zinc-500 mt-1">Selected {runs.length}/3 for comparison</p>
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Active leg entries</div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[72px_104px_minmax(0,1fr)_124px_82px_104px_148px] bg-zinc-950 border-b border-zinc-800 px-4 py-3 text-[10px] uppercase tracking-widest text-zinc-600 font-black">
              <div>Run</div>
              <div>Type</div>
              <div>Track / Bike</div>
              <div>Best Lap</div>
              <div>Laps</div>
              <div>Weight</div>
              <div className="text-right">Compare</div>
            </div>

            <div className="divide-y divide-zinc-800">
              {compareCandidates.map(run => {
                const isSelected = selectedIds.has(run.id);
                const isDisabled = !isSelected && runs.length >= 3;
                return (
                  <div
                    key={run.id}
                    className={cn(
                      "grid grid-cols-[72px_104px_minmax(0,1fr)_124px_82px_104px_148px] items-center px-4 py-3 gap-0 transition-colors",
                      isSelected ? "bg-racing-blue-light/5" : "hover:bg-white/[0.03]"
                    )}
                  >
                    <div className="font-mono text-racing-blue-light font-black text-lg">R{run.runNumber}</div>
                    <div><SessionBadge type={run.sessionType} /></div>
                    <div className="min-w-0 pr-4">
                      <div className="font-bold text-white text-sm truncate">{run.trackName}</div>
                      <div className="text-[10px] text-zinc-500 uppercase tracking-widest truncate">{run.bikeName} | {formatDisplayDate(run.date)}</div>
                    </div>
                    <div>
                      <div className="font-mono font-black text-white text-base">{run.bestLapTime}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">AVG {run.avgLapTime}</div>
                    </div>
                    <div className="font-mono font-bold text-zinc-300">{run.lapsCompleted}</div>
                    <div className="font-mono font-bold text-zinc-300">{run.weight || '--'}</div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => isSelected ? onRemoveRun(run.id) : onAddRun(run.id)}
                        disabled={isDisabled}
                        className={cn(
                          "min-h-11 min-w-[124px] px-4 border text-xs font-black uppercase tracking-widest transition-colors",
                          isSelected
                            ? "border-racing-blue-light/50 bg-racing-blue-light/10 text-racing-blue-light"
                            : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-racing-blue-light/40 hover:text-white",
                          isDisabled && "opacity-35 cursor-not-allowed hover:border-zinc-700 hover:text-zinc-300"
                        )}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {compareCandidates.length === 0 && (
              <div className="p-12 text-center text-zinc-600 italic">No stints logged in this race weekend yet.</div>
            )}
          </div>
        </div>
      </section>

      {runs.length < 2 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-zinc-900/30 border-2 border-dashed border-zinc-800 rounded-none">
          <GitCompare size={64} className="text-zinc-700 mb-6" />
          <h3 className="text-xl font-bold uppercase tracking-tight text-white mb-2">Select Stints To Compare</h3>
          <p className="text-zinc-500 italic max-w-sm text-center">Use the table above to choose at least two entries from the active race weekend.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={cn(
            "grid grid-cols-1 gap-3",
            runs.length === 2 ? "md:grid-cols-2 max-w-3xl" : "md:grid-cols-3"
          )}>
            {runs.map(run => {
              const gap = timeToMs(run.bestLapTime) - bestLapMs;
              return (
                <div key={run.id} className="bg-zinc-900 border border-zinc-800 p-4 relative min-w-0">
                  <button aria-label={`Remove R${run.runNumber} from comparison`} onClick={() => onRemoveRun(run.id)} className="absolute top-3 right-3 min-h-10 min-w-10 inline-flex items-center justify-center text-zinc-500 hover:text-racing-red border border-zinc-800">
                    <Trash2 size={15} />
                  </button>
                  <div className="flex items-center gap-2 mb-3 pr-10">
                    <span className="text-racing-blue-light font-black italic leading-none text-xl">R{run.runNumber}</span>
                    <SessionBadge type={run.sessionType} />
                  </div>
                  <div className="text-sm font-bold text-white leading-snug break-words">{run.trackName}</div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">{formatDisplayDate(run.date)} / {run.weight || '--'}</div>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <CompareMetric label="Best" value={run.bestLapTime} active={gap === 0} />
                    <CompareMetric label="Gap" value={gap === 0 ? 'PB' : `+${(gap / 1000).toFixed(3)}s`} />
                    <CompareMetric label="Laps" value={run.lapsCompleted.toString()} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto pb-4 custom-scrollbar">
          <div className="min-w-[760px] bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
            <table className="w-full table-fixed border-collapse">
               <thead>
                 <tr className="bg-zinc-950 border-b border-zinc-800">
                    <th className="w-[28%] p-4 lg:p-5 text-left border-r border-zinc-800 align-middle">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black leading-snug">Parameter Matrix</span>
                    </th>
                    {runs.map(run => (
                      <th key={run.id} className="p-4 lg:p-5 text-left border-r border-zinc-800 group relative align-top">
        <button aria-label={`Remove R${run.runNumber} from comparison`} onClick={() => onRemoveRun(run.id)} className="absolute top-2 right-2 min-h-8 min-w-8 inline-flex items-center justify-center text-zinc-600 hover:text-racing-blue-light transition-colors">
          <Trash2 size={14} />
        </button>
        <div className="flex flex-col min-w-0 pr-8">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-racing-blue-light font-black italic leading-none">R{run.runNumber}</span>
            <SessionBadge type={run.sessionType} />
          </div>
                           <span className="text-sm font-bold text-white leading-snug break-words">{run.trackName}</span>
                           <span className="text-[10px] text-zinc-500 uppercase tracking-normal mt-1">{formatDisplayDate(run.date)}</span>
                        </div>
                      </th>
                    ))}
                 </tr>
               </thead>
               <tbody className="divide-y divide-zinc-800">
                  <CompareRow label="Best Lap Time" highlight>
                    {runs.map(r => (
                      <div key={r.id} className="flex flex-col">
                        <span className={cn("font-mono font-bold text-xl", timeToMs(r.bestLapTime) === bestLapMs ? "text-emerald-500" : "text-white")}>{r.bestLapTime}</span>
                        {timeToMs(r.bestLapTime) !== bestLapMs && (
                          <span className="text-[10px] text-racing-blue-light font-bold">+{((timeToMs(r.bestLapTime) - bestLapMs)/1000).toFixed(3)}s</span>
                        )}
                      </div>
                    ))}
                  </CompareRow>
                  
                  <CompareRow label="Average Lap">
                    {runs.map(r => <span key={r.id} className="font-mono font-bold text-zinc-200">{r.avgLapTime}</span>)}
                  </CompareRow>
                  <CompareRow label="Weight">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.weight || '--'}</span>)}
                  </CompareRow>

                  <CompareHeader label="CONDITIONS" />
                  <CompareRow label="Weather">
                    {runs.map(r => <span key={r.id} className="text-xs uppercase font-bold text-zinc-400">{r.weather}</span>)}
                  </CompareRow>
                  <CompareRow label="Track Condition">
                    {runs.map(r => <span key={r.id} className="text-xs uppercase font-bold text-zinc-400">{r.trackCondition}</span>)}
                  </CompareRow>

                  <CompareHeader label="TIRE DYNAMICS" />
                  <CompareRow label="Tire Pressure">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.tirePressure.front} / {r.setup.tirePressure.rear} <span className="text-zinc-600 text-[10px]">{r.setup.tirePressure.unit}</span></span>)}
                  </CompareRow>
                  <CompareRow label="Tire Compound">
                    {runs.map(r => <span key={r.id} className="text-xs uppercase font-bold text-zinc-400">{r.tireBrand}</span>)}
                  </CompareRow>

                  <CompareHeader label="SUSPENSION GEOMETRY" />
                  <CompareRow label="Front Spring / Preload">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.frontSuspension.springRate} / {r.setup.frontSuspension.preload}</span>)}
                  </CompareRow>
                  <CompareRow label="Front Compression">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.frontSuspension.compression}</span>)}
                  </CompareRow>
                  <CompareRow label="Front Rebound">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.frontSuspension.rebound}</span>)}
                  </CompareRow>
                  <CompareRow label="Rear Compression">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.rearSuspension.compression}</span>)}
                  </CompareRow>
                  <CompareRow label="Rear Rebound">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.rearSuspension.rebound}</span>)}
                  </CompareRow>
                  <CompareRow label="Rear Ride Height / Sag">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.rearSuspension.rideHeight} / {r.setup.rearSuspension.sag}</span>)}
                  </CompareRow>

                  <CompareHeader label="ENGINE & GEARING" />
                  <CompareRow label="Final Ratio">
                    {runs.map(r => <span key={r.id} className="font-mono font-bold text-zinc-200">{r.setup.gearing.finalDrive.toFixed(3)} <span className="text-zinc-600 text-[10px]">({r.setup.gearing.front}/{r.setup.gearing.rear})</span></span>)}
                  </CompareRow>
                  <CompareRow label="Electronics (TC/ABS)">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.electronics.tc} / {r.setup.electronics.abs}</span>)}
                  </CompareRow>
                  <CompareRow label="Power / Engine Brake">
                    {runs.map(r => <span key={r.id} className="font-mono">{r.setup.electronics.powerMode} / EB {r.setup.electronics.eb}</span>)}
                  </CompareRow>

                  <CompareHeader label="RIDER FEEDBACK" />
                  <CompareRow label="Confidence Rating">
                    {runs.map(r => (
                      <div key={r.id} className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => <div key={i} className={cn("w-2 h-2 rounded-full", i < r.confidenceRating ? "bg-racing-blue-light" : "bg-zinc-800")} />)}
                      </div>
                    ))}
                  </CompareRow>
                  <CompareRow label="Rider Comments">
                    {runs.map(r => <p key={r.id} className="text-[10px] italic text-zinc-400 line-clamp-4 leading-relaxed prose-invert">"{r.riderComment}"</p>)}
                  </CompareRow>
                  <CompareRow label="Next Plan">
                    {runs.map(r => <p key={r.id} className="text-[10px] text-zinc-400 line-clamp-4 leading-relaxed">{r.nextRunPlan || '--'}</p>)}
                  </CompareRow>
               </tbody>
            </table>
          </div>
        </div>
        </div>
      )}
    </motion.div>
  );
}

function SettingsView({
  settings,
  onSettingsChange,
  onClearData,
}: {
  settings: AppSettings,
  onSettingsChange: (settings: AppSettings) => void,
  onClearData: () => void,
}) {
  const [activeTab, setActiveTab] = useState<'customization' | 'data'>('customization');

  const updateSetting = (key: keyof AppSettings, value: string) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const logoDataUrl = await resizeLogoFile(file);
      updateSetting('logoDataUrl', logoDataUrl);
    } catch (error) {
      console.error('Logo upload failed:', error);
      alert('Could not process that logo. Try a PNG or JPG image under 5 MB.');
    } finally {
      event.target.value = '';
    }
  };

  const resetCustomization = () => onSettingsChange(DEFAULT_APP_SETTINGS);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.98 }}
      className="space-y-6 max-w-4xl"
    >
      <header>
        <h2 className="text-4xl font-black italic tracking-tighter uppercase">Configuration</h2>
        <p className="text-zinc-500 font-medium tracking-wide">Customize the app shell and manage synced data.</p>
      </header>

      <div className="flex border-b border-zinc-800 overflow-x-auto no-scrollbar">
        {[
          ['customization', 'Customization'],
          ['data', 'Data']
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as 'customization' | 'data')}
            className={cn(
              "px-5 lg:px-8 py-3 lg:py-4 text-[11px] lg:text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap",
              activeTab === id ? "border-racing-blue-light text-racing-blue-light bg-racing-blue-light/5" : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'customization' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-xs font-bold text-racing-blue-light uppercase tracking-[0.3em] flex items-center gap-2">
                <Palette size={16} /> App Colors
              </h3>
              <button onClick={resetCustomization} className="min-h-10 px-4 border border-zinc-800 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <RotateCcw size={15} /> Reset
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <ColorGroup label="Primary Accent" value={settings.primaryColor} onChange={v => updateSetting('primaryColor', v)} />
              <ColorGroup label="Header / Action" value={settings.secondaryColor} onChange={v => updateSetting('secondaryColor', v)} />
              <ColorGroup label="Danger Accent" value={settings.dangerColor} onChange={v => updateSetting('dangerColor', v)} />
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-zinc-800">
              <h3 className="text-xs font-bold text-racing-blue-light uppercase tracking-[0.3em] flex items-center gap-2">
                <ImageIcon size={16} /> Header Logo
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="h-24 border border-zinc-800 bg-zinc-950 flex items-center justify-center">
                {settings.logoDataUrl ? (
                  <img src={settings.logoDataUrl} alt="Current app logo" className="max-h-20 max-w-[160px] object-contain" />
                ) : (
                  <span className="text-xs text-zinc-600 uppercase tracking-widest font-bold">No Logo</span>
                )}
              </div>
              <label className="min-h-11 w-full flex items-center justify-center gap-2 bg-racing-blue-dark border border-racing-blue-light/30 text-white px-4 py-3 text-xs font-bold uppercase tracking-widest cursor-pointer">
                <Upload size={16} /> Upload Logo
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-500 uppercase tracking-wider">
                Logos are resized before syncing so every device receives the same header image.
              </p>
              {settings.logoDataUrl && (
                <button onClick={() => updateSetting('logoDataUrl', '')} className="min-h-11 w-full border border-zinc-800 text-zinc-400 hover:text-white px-4 py-3 text-xs font-bold uppercase tracking-widest">
                  Remove Logo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'data' && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-none overflow-hidden shadow-2xl">
        <div className="p-8">
          <section>
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
              <AlertTriangle size={16} className="text-racing-red" /> Danger Zone
            </h3>
            <div>
              <h4 className="font-bold text-white mb-1">Clear Synced Archive</h4>
              <p className="text-xs text-zinc-500 mb-4">Permanently delete all synced stints and app settings from every connected device.</p>
              <button 
                onClick={onClearData}
                className="flex items-center gap-2 text-racing-red border border-racing-red/30 bg-racing-red/5 hover:bg-racing-red hover:text-white px-6 py-3 rounded-none text-xs font-bold uppercase tracking-widest transition-all"
              >
                <Trash2 size={18} /> Wipe Synced Logbook
              </button>
            </div>
          </section>
        </div>
      </div>
      )}

      <div className="bg-zinc-950/50 border border-zinc-800 p-6 rounded-none flex items-center justify-between">
         <div className="flex items-center gap-4">
            <div className="bg-zinc-900 p-3 rounded-none border border-zinc-800">
               <Info size={20} className="text-racing-blue-light" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">RaceLog Pro Engineering v2.6.5</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">BMW Motorrad Motorsport</p>
            </div>
         </div>
      </div>
    </motion.div>
  );
}

// --- Helper Components ---

function LegFact({ label, value }: { label: string, value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-600 font-black mb-1">{label}</div>
      <div className="text-sm lg:text-base font-black text-zinc-100 leading-snug break-words">{value}</div>
    </div>
  );
}

function DetailFact({ label, value }: { label: string, value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-1">{label}</div>
      <div className="font-bold text-sm text-zinc-200 leading-snug break-words">{value}</div>
    </div>
  );
}

function ColorGroup({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{label}</label>
      <div className="flex items-center gap-3 bg-racing-black-bg border border-white/5 px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={event => onChange(event.target.value)}
          className="h-9 w-12 bg-transparent border-0 p-0 cursor-pointer"
        />
        <input
          value={value}
          onChange={event => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-mono text-zinc-200 focus:outline-none"
        />
      </div>
    </div>
  );
}

function CompareMetric({ label, value, active }: { label: string, value: string, active?: boolean }) {
  return (
    <div className={cn("border border-zinc-800 bg-zinc-950 p-3 min-w-0", active && "border-racing-blue-light/40 bg-racing-blue-light/5")}>
      <div className="text-[9px] uppercase tracking-widest text-zinc-600 font-black mb-1">{label}</div>
      <div className={cn("font-mono text-sm font-black leading-tight break-words", active ? "text-racing-blue-light" : "text-zinc-200")}>{value}</div>
    </div>
  );
}

function TouchIconButton({ label, onClick, icon: Icon, tone = 'default' }: { label: string, onClick: () => void, icon: any, tone?: 'default' | 'danger' }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "min-h-11 min-w-11 inline-flex items-center justify-center border bg-zinc-950 text-zinc-400 transition-colors touch-manipulation",
        tone === 'danger'
          ? "border-racing-red/20 hover:bg-racing-red hover:text-white hover:border-racing-red"
          : "border-zinc-800 hover:bg-zinc-800 hover:text-white hover:border-zinc-700"
      )}
    >
      <Icon size={18} />
    </button>
  );
}

function StatCard({ label, value, sub, icon: Icon, trend, glow, className }: any) {
  return (
    <div className={cn(
      "bg-racing-panel p-3 lg:p-4 border border-white/5 flex flex-col group transition-all duration-300 relative overflow-hidden active:bg-white/5",
      glow && "ring-1 ring-racing-blue-light/20 shadow-[0_0_30px_rgba(60,182,227,0.1)]",
      className
    )}>
      <div className="flex justify-between items-start mb-2 lg:mb-2 relative z-10">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-black group-hover:text-racing-blue-light transition-colors">{label}</span>
        <Icon size={16} className="text-white/20" />
      </div>
      <div className="text-2xl lg:text-3xl font-mono font-bold mt-1 tracking-tighter relative z-10 text-gray-100">
        {value}
      </div>
      <div className="flex items-center justify-between mt-2 lg:mt-4 relative z-10 min-w-0">
        <span className="text-[10px] text-gray-500 font-mono font-medium truncate uppercase">{sub}</span>
        {trend !== null && trend !== undefined && (
          <div className={cn("flex items-center gap-1 text-[10px] font-mono font-black", trend ? "text-racing-blue-light" : "text-racing-red")}>
            {trend ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            {trend ? 'IMPROVED' : 'GAP'}
          </div>
        )}
      </div>
      {glow && <div className="absolute top-0 right-0 w-16 h-16 bg-racing-blue-light/5 blur-2xl -mr-8 -mt-8" />}
    </div>
  );
}
function SetupMiniCard({ label, value, icon: Icon }: { label: string, value: string, icon: any }) {
  return (
    <div className="flex items-center gap-3 lg:gap-4 bg-zinc-950 p-2.5 lg:p-3 rounded-none border border-zinc-800 group hover:border-racing-blue-light/30 transition-all">
       <div className="p-1.5 lg:p-2 bg-zinc-900 rounded-none group-hover:bg-racing-blue-dark group-hover:text-white transition-colors text-zinc-500">
         <Icon size={16} />
       </div>
       <div className="flex-1 overflow-hidden">
          <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{label}</p>
          <p className="text-xs font-bold text-zinc-200 truncate">{value}</p>
       </div>
    </div>
  );
}

function SessionBadge({ type }: { type: SessionType }) {
  const styles: any = {
    Practice: 'bg-emerald-600/10 text-emerald-500 border-emerald-500/20',
    Qualifying: 'bg-racing-blue-light/10 text-racing-blue-light border-racing-blue-light/20',
    Race: 'bg-racing-red/10 text-racing-red border-racing-red/20',
    Test: 'bg-racing-blue-dark/10 text-racing-blue-dark border-racing-blue-dark/20'
  };
  return (
    <span className={cn("px-2 py-0.5 border text-[9px] font-black uppercase tracking-widest", styles[type])}>
      {type}
    </span>
  );
}

function InputGroup({ label, value, onChange, placeholder, type = 'text', step, fontMono, required }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest">
        {label} {required && <span className="text-racing-red">*</span>}
      </label>
      <input 
        type={type} 
        value={value} 
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        step={step}
        className={cn(
          "w-full bg-racing-black-bg border border-white/5 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-racing-blue-light/50 transition-all text-gray-100",
          fontMono && "font-mono"
        )}
      />
    </div>
  );
}

function DateGroup({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{label}</label>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-racing-black-bg border border-white/5 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-racing-blue-light/50 transition-all text-gray-100"
      />
      <div className="text-xs text-zinc-400 font-bold leading-snug">{formatDisplayDate(value)}</div>
    </div>
  );
}

function SelectGroup({ label, options, value, onChange }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{label}</label>
      <select 
        value={value} 
        onChange={e => onChange(e.target.value)}
        className="w-full bg-racing-black-bg border border-white/5 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-racing-blue-light/50 appearance-none cursor-pointer text-gray-100"
      >
        {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function RangeGroup({ label, value, onChange }: any) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</label>
        <span className="text-xs font-mono font-bold text-racing-blue-light">{value} / 5</span>
      </div>
      <input 
        type="range" 
        min="1" 
        max="5" 
        step="1" 
        value={value} 
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-zinc-800 rounded-none appearance-none cursor-pointer accent-racing-blue-light"
      />
    </div>
  );
}

function SetupSection({ title, icon: Icon, children }: any) {
  return (
    <div className="border border-white/5 bg-racing-panel flex flex-col group overflow-hidden">
       <div className="px-4 py-2 bg-racing-accent border-b border-white/5 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-[10px] font-black text-racing-blue-light uppercase tracking-[0.2em] italic">
             <Icon size={12} /> {title}
          </h4>
       </div>
       <div className="p-4 space-y-3">
         {children}
       </div>
    </div>
  );
}

function SetupRow({ label, value, unit }: any) {
  return (
    <div className="grid grid-cols-[minmax(68px,auto)_minmax(0,1fr)] gap-3 items-start group">
       <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest group-hover:text-zinc-500 transition-colors">{label}</span>
       <span className="font-mono font-bold text-sm text-zinc-300 text-right leading-snug break-words min-w-0">
         {value} {unit && <span className="text-[10px] font-normal text-zinc-600 ml-0.5">{unit}</span>}
       </span>
    </div>
  );
}

function RatingCircle({ label, value }: { label: string, value: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-12 h-12 flex items-center justify-center mb-1">
        <svg className="w-full h-full -rotate-90">
           <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" fill="transparent" className="text-zinc-800" />
           <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" fill="transparent" strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 * (1 - value/5)} className="text-racing-blue-light" />
        </svg>
        <span className="absolute font-mono font-bold text-xs">{value}</span>
      </div>
      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span>
    </div>
  );
}

function CompareHeader({ label }: { label: string }) {
  return (
    <tr className="bg-zinc-950/70 border-y border-zinc-800">
      <td className="px-6 py-2" colSpan={4}>
         <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.4em]">{label}</span>
      </td>
    </tr>
  );
}

function CompareRow({ label, children, highlight = false }: { label: string, children: React.ReactNode[], highlight?: boolean }) {
  return (
    <tr className={cn("group transition-colors", highlight ? "bg-racing-blue-light/[0.02]" : "hover:bg-zinc-800/10")}>
       <td className="p-4 lg:p-5 border-r border-zinc-800 bg-zinc-950/20 align-top">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wide leading-snug">{label}</span>
       </td>
       {children.map((child, idx) => (
         <td key={idx} className="p-4 lg:p-5 border-r border-zinc-800 font-mono text-sm text-zinc-300 align-top break-words">
           {child}
         </td>
       ))}
    </tr>
  );
}
