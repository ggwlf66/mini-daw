const PROJECT_STORAGE_KEY = 'mini-daw-project-v1';

const DRUMPAD_DEFAULTS = [
    { name: 'Kick', key: '1', fallbackFreq: 96 },
    { name: 'Snare', key: '2', fallbackFreq: 180 },
    { name: 'Hi-Hat', key: '3', fallbackFreq: 420 },
    { name: 'Clap', key: '4', fallbackFreq: 320 },
    { name: 'Tom Low', key: '5', fallbackFreq: 140 },
    { name: 'Tom Mid', key: '6', fallbackFreq: 180 },
    { name: 'Tom High', key: '7', fallbackFreq: 230 },
    { name: 'Crash', key: '8', fallbackFreq: 520 }
];

const DEFAULT_SYNTH_PRESET = {
    waveform: 'sine',
    attack: 0.01,
    release: 0.35,
    sampleName: '',
    sampleId: '',
    sampleDataUrl: '',
    sampleBuffer: null,
    rootFreq: 261.63
};

function clonePadPreset(pad, fallback) {
    const safeFallback = fallback || DRUMPAD_DEFAULTS[0];
    const parsedGain = Number(pad?.gain);

    return {
        name: pad?.name || safeFallback.name,
        key: pad?.key || safeFallback.key,
        fallbackFreq: Number(pad?.fallbackFreq ?? safeFallback.fallbackFreq),
        sampleName: pad?.sampleName || '',
        sampleId: pad?.sampleId || '',
        sampleDataUrl: pad?.sampleDataUrl || '',
        sampleBuffer: pad?.sampleBuffer || null,
        waveType: pad?.waveType || 'triangle',
        sourceMode: pad?.sourceMode === 'tone' ? 'tone' : 'sample',
        gain: Number.isFinite(parsedGain) ? Math.min(1, Math.max(0, parsedGain)) : 1
    };
}

export function createDrumpadPreset(name = 'Default Kit') {
    return {
        id: `drm-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name,
        kind: 'drumpad',
        pads: DRUMPAD_DEFAULTS.map((pad) => clonePadPreset(pad, pad))
    };
}

export function createSynthPreset(name = 'Init Synth') {
    return {
        id: `syn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name,
        kind: 'synth',
        ...DEFAULT_SYNTH_PRESET
    };
}

export function createTrackPreset(_type) {
    return {
        drumpad: createDrumpadPreset('Default Kit'),
        synth: createSynthPreset('Init Synth')
    };
}

export function createTrack(name, type = 'drumpad') {
    return {
        id: `track-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name,
        type,
        preset: createTrackPreset(type),
        clips: [],
        volume: 1,
        muted: false,
        solo: false
    };
}

export function createProjectState() {
    const initialTrack = createTrack('Track 1', 'drumpad');

    return {
        bpm: 120,
        playheadTime: 0,
        activeTrackId: initialTrack.id,
        tracks: [initialTrack],
        presets: {
            drumpad: [createDrumpadPreset('Default Kit')],
            synth: [createSynthPreset('Init Synth')]
        }
    };
}

export function cloneDrumpadPreset(preset) {
    const source = preset || createDrumpadPreset('Default Kit');

    return {
        ...source,
        kind: 'drumpad',
        pads: DRUMPAD_DEFAULTS.map((fallback, index) => clonePadPreset(source.pads?.[index], fallback))
    };
}

export function cloneSynthPreset(preset) {
    const source = preset || createSynthPreset('Init Synth');
    return {
        ...DEFAULT_SYNTH_PRESET,
        ...source,
        kind: 'synth'
    };
}

export function addDrumpadPreset(projectState, presetName, presetPayload) {
    const safeName = (presetName || '').trim() || 'Untitled Kit';
    const preset = {
        ...createDrumpadPreset(safeName),
        ...cloneDrumpadPreset(presetPayload),
        id: `drm-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: safeName,
        kind: 'drumpad'
    };

    projectState.presets.drumpad.push(preset);
    return preset;
}

function sanitizeEvent(eventItem) {
    const parsedVelocity = Number(eventItem.velocity);
    return {
        id: eventItem.id,
        source: eventItem.source || 'unknown',
        label: eventItem.label || 'event',
        kind: eventItem.kind || 'tone',
        padIndex: typeof eventItem.padIndex === 'number' ? eventItem.padIndex : null,
        note: eventItem.note || null,
        frequency: typeof eventItem.frequency === 'number' ? eventItem.frequency : null,
        waveType: eventItem.waveType || null,
        startTime: Number(eventItem.startTime) || 0,
        duration: Math.max(0.01, Number(eventItem.duration) || 0.25),
        velocity: Number.isFinite(parsedVelocity) ? Math.min(1, Math.max(0, parsedVelocity)) : 1
    };
}

function sanitizeClip(clip) {
    return {
        id: clip.id || `clip-${Date.now()}`,
        name: clip.name || 'Clip',
        startTime: Math.max(0, Number(clip.startTime) || 0),
        duration: Math.max(0.01, Number(clip.duration) || 0.25),
        color: clip.color || 'hsl(193 68% 52%)',
        events: Array.isArray(clip.events) ? clip.events.map(sanitizeEvent) : []
    };
}

function sanitizeTrack(track, fallbackName) {
    const safeType = ['drumpad', 'synth', 'audio'].includes(track?.type) ? track.type : 'drumpad';
    const safePreset = track?.preset || createTrackPreset(safeType);

    return {
        id: track?.id || `track-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: track?.name || fallbackName,
        type: safeType,
        preset: {
            drumpad: cloneDrumpadPreset(safePreset.drumpad),
            synth: cloneSynthPreset(safePreset.synth)
        },
        clips: Array.isArray(track?.clips) ? track.clips.map(sanitizeClip) : [],
        volume: Math.min(1, Math.max(0, Number(track?.volume ?? 1))),
        muted: Boolean(track?.muted),
        solo: Boolean(track?.solo)
    };
}

export function normalizeProjectState(inputState) {
    const base = createProjectState();
    const source = inputState || {};

    const tracks = Array.isArray(source.tracks) && source.tracks.length > 0
        ? source.tracks.map((track, index) => sanitizeTrack(track, `Track ${index + 1}`))
        : base.tracks;

    const presets = {
        drumpad: Array.isArray(source.presets?.drumpad) && source.presets.drumpad.length > 0
            ? source.presets.drumpad.map(cloneDrumpadPreset)
            : base.presets.drumpad,
        synth: Array.isArray(source.presets?.synth) && source.presets.synth.length > 0
            ? source.presets.synth.map(cloneSynthPreset)
            : base.presets.synth
    };

    let activeTrackId = source.activeTrackId;
    if (!tracks.some((track) => track.id === activeTrackId)) {
        activeTrackId = tracks[0]?.id || base.activeTrackId;
    }

    return {
        bpm: Math.min(240, Math.max(40, Number(source.bpm) || base.bpm)),
        playheadTime: Math.max(0, Number(source.playheadTime) || 0),
        activeTrackId,
        tracks,
        presets
    };
}

function stripSampleBuffers(projectState) {
    const normalized = normalizeProjectState(projectState);

    const tracks = normalized.tracks.map((track) => ({
        ...track,
        preset: {
            drumpad: {
                ...track.preset.drumpad,
                pads: track.preset.drumpad.pads.map((pad) => ({
                    ...pad,
                    sampleId: pad.sampleId || '',
                    sampleDataUrl: pad.sampleId ? '' : (pad.sampleDataUrl || ''),
                    sampleBuffer: null
                }))
            },
            synth: {
                ...track.preset.synth,
                sampleDataUrl: track.preset.synth.sampleId ? '' : (track.preset.synth.sampleDataUrl || ''),
                sampleBuffer: null
            }
        },
        clips: track.clips.map((clip) => ({
            ...clip,
            events: clip.events.map((eventItem) => ({
                ...eventItem
            }))
        }))
    }));

    const presets = {
        drumpad: normalized.presets.drumpad.map((preset) => ({
            ...preset,
            pads: preset.pads.map((pad) => ({
                ...pad,
                sampleId: pad.sampleId || '',
                sampleDataUrl: pad.sampleId ? '' : (pad.sampleDataUrl || ''),
                sampleBuffer: null
            }))
        })),
        synth: normalized.presets.synth.map((preset) => ({ ...preset }))
    };

    presets.synth = presets.synth.map((preset) => ({
        ...preset,
        sampleDataUrl: preset.sampleId ? '' : (preset.sampleDataUrl || ''),
        sampleBuffer: null
    }));

    return {
        ...normalized,
        tracks,
        presets
    };
}

export function saveProjectState(projectState) {
    try {
        const payload = stripSampleBuffers(projectState);
        window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(payload));
        return true;
    } catch (_error) {
        return false;
    }
}

export function loadProjectState() {
    try {
        const raw = window.localStorage.getItem(PROJECT_STORAGE_KEY);
        if (!raw) {
            return createProjectState();
        }

        const parsed = JSON.parse(raw);
        return normalizeProjectState(parsed);
    } catch (_error) {
        return createProjectState();
    }
}
