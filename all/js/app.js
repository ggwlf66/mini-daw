import { AudioEngine } from './audio-engine.js';
import { initDrumpad } from './ui/drumpad.js';
import { initPiano } from './ui/piano.js';
import { initLibraryUI } from './ui/library.js';
import { PlaylistUI } from './ui/playlist.js';
import { Recorder } from './recorder.js';
import { MixerUI } from './ui/mixer.js';
import { DawDB } from './db.js';
import {
    addDrumpadPreset,
    cloneDrumpadPreset,
    cloneSynthPreset,
    createProjectState,
    createSynthPreset,
    createTrackPreset,
    loadProjectState,
    normalizeProjectState,
    saveProjectState
} from './state.js';

const audioEngine = new AudioEngine();
const db = new DawDB();
const sampleStore = db;
const projectState = loadProjectState() || createProjectState();

const metronomeButton = document.querySelector('#metronome-toggle-btn');
const toggleMixerButton = document.querySelector('#toggle-mixer-btn');
const toggleDrumpadButton = document.querySelector('#toggle-drumpad-btn');
const togglePianoButton = document.querySelector('#toggle-piano-btn');
const toggleLibraryButton = document.querySelector('#toggle-library-btn');
const projectMenuButton = document.querySelector('#projectMenuBtn');
const projectDropdown = projectMenuButton?.closest('.project-dropdown') || null;
const projectMenu = projectDropdown?.querySelector('.dropdown-menu') || null;
const menuImportFile = document.querySelector('#menu-import-file');
const menuImportFolder = document.querySelector('#menu-import-folder');
const menuSaveProject = document.querySelector('#menu-save-project');
const menuLoadProject = document.querySelector('#menu-load-project');
const menuExportWav = document.querySelector('#menu-export-wav');
const hiddenSampleInput = document.querySelector('#hidden-sample-input');
const hiddenFolderInput = document.querySelector('#hidden-folder-input');
const bpmNumber = document.querySelector('#bpm-number');
const bpmDecreaseButton = document.querySelector('#bpm-decrease-btn');
const bpmIncreaseButton = document.querySelector('#bpm-increase-btn');
const toolbarAddTrackButton = document.querySelector('#toolbar-add-track-btn');
const toolbarRemoveTrackButton = document.querySelector('#toolbar-remove-track-btn');
const toolbarSplitButton = document.querySelector('#toolbar-split-btn');
const testToneButton = document.querySelector('#test-tone-btn');
const audioStatus = document.querySelector('#audio-status');
const drumpadContainer = document.querySelector('#drumpad-container');
const pianoContainer = document.querySelector('#piano-container');
const playlistContainer = document.querySelector('#playlist-container');
const mixerDrawer = document.querySelector('#mixer-drawer');
const libraryDrawer = document.querySelector('#library-drawer');
const libraryList = document.querySelector('#library-list');
const drumpadDrawer = document.querySelector('#drumpad-drawer');
const pianoDrawer = document.querySelector('#piano-drawer');
const playPauseButton = document.querySelector('#play-pause-btn');
const playPauseIcon = document.querySelector('#play-pause-icon');
const stopButton = document.querySelector('#stop-btn');
const recordButton = document.querySelector('#record-btn');
const headerTrackSelect = document.querySelector('#header-track-select');
const mixerContainer = document.querySelector('#mixer-container');

let isPlaying = false;
let playbackOffset = 0;
let playbackStartCtxTime = 0;
let transportRafId = 0;
let mixer = null;
let drumpadUI = null;
let pianoUI = null;
let libraryUI = null;
let persistTimer = 0;
let isRecordArmed = false;
let recordStartPlayhead = 0;
let samplePickerRequest = null;

const originalSaveSampleFile = sampleStore.saveFile.bind(sampleStore);
sampleStore.saveFile = async (file, options = {}) => {
    const sampleId = await originalSaveSampleFile(file, options);
    if (libraryDrawer?.classList.contains('open')) {
        refreshSampleLibrary().catch(() => {
            // no-op: library refresh failure should not block sample save.
        });
    }
    return sampleId;
};

function getActiveTrackIndex() {
    const index = projectState.tracks.findIndex((track) => track.id === projectState.activeTrackId);
    return Math.max(0, index);
}

function syncActiveTrackIndex() {
    projectState.activeTrackIndex = getActiveTrackIndex();
}

function refreshHeaderTrackSelect() {
    if (!headerTrackSelect) {
        return;
    }

    const activeId = projectState.activeTrackId;
    headerTrackSelect.innerHTML = '';

    projectState.tracks.forEach((track, index) => {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = `${track.name} [${track.type}]`;
        if (track.id === activeId) {
            option.selected = true;
        }
        option.dataset.index = String(index);
        headerTrackSelect.appendChild(option);
    });

    if (!projectState.tracks.some((track) => track.id === headerTrackSelect.value)) {
        headerTrackSelect.value = activeId || projectState.tracks[0]?.id || '';
    }
}

function schedulePersist() {
    if (persistTimer) {
        window.clearTimeout(persistTimer);
    }

    persistTimer = window.setTimeout(() => {
        saveProjectState(projectState);
    }, 180);
}

function setStatus(message, isError = false) {
    if (!audioStatus) {
        return;
    }

    audioStatus.textContent = message;
    audioStatus.dataset.state = isError ? 'error' : 'info';
}

function getActiveTrack() {
    return projectState.tracks.find((track) => track.id === projectState.activeTrackId) || null;
}

function ensureTrackPreset(track) {
    if (!track) {
        return;
    }

    if (!track.preset) {
        track.preset = createTrackPreset(track.type);
    }

    if (!track.preset.drumpad) {
        track.preset.drumpad = createTrackPreset(track.type).drumpad;
    }

    if (!track.preset.synth) {
        track.preset.synth = createTrackPreset(track.type).synth;
    }
}

function addSynthPresetToState(presetName, presetPayload) {
    const safeName = (presetName || '').trim() || 'Untitled Synth';
    const preset = {
        ...createSynthPreset(safeName),
        ...cloneSynthPreset(presetPayload),
        id: `syn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: safeName,
        kind: 'synth'
    };

    projectState.presets.synth.push(preset);
    return preset;
}

function overwriteSynthPresetInState(presetId, presetPayload) {
    const index = projectState.presets.synth.findIndex((preset) => preset.id === presetId);
    if (index < 0) {
        return null;
    }

    const existing = projectState.presets.synth[index];
    const nextPreset = {
        ...cloneSynthPreset(presetPayload),
        id: existing.id,
        name: (presetPayload?.name || existing.name || 'Init Synth').trim() || 'Init Synth',
        kind: 'synth'
    };

    projectState.presets.synth[index] = nextPreset;
    return nextPreset;
}

function syncInstrumentsFromActiveTrack() {
    const activeTrack = getActiveTrack();
    if (!activeTrack) {
        return;
    }

    ensureTrackPreset(activeTrack);
    drumpadUI?.applyPreset(activeTrack.preset.drumpad);
    pianoUI?.applySynthPreset(activeTrack.preset.synth);
}

const playlist = new PlaylistUI({
    container: playlistContainer,
    initialTracks: projectState.tracks,
    initialActiveTrackId: projectState.activeTrackId,
    initialPlayheadTime: projectState.playheadTime,
    onStateChange: (nextState) => {
        projectState.tracks = nextState.tracks;
        projectState.playheadTime = nextState.playheadTime;
        projectState.activeTrackId = nextState.activeTrackId;
        syncActiveTrackIndex();
        refreshHeaderTrackSelect();
        mixer?.render(projectState.tracks, projectState.activeTrackId);
        schedulePersist();

        if (!isPlaying) {
            playbackOffset = playlist.getPlayheadTime();
            setStatus(`Audio allapot: ${audioEngine.getState()} | playhead ${playlist.getPlayheadTime().toFixed(2)}s`);
        }
    },
    onActiveTrackChange: () => {
        syncActiveTrackIndex();
        refreshHeaderTrackSelect();
        syncInstrumentsFromActiveTrack();
    }
});

mixer = new MixerUI({
    container: mixerContainer,
    onTrackMixChange: (trackId, patch) => {
        playlist.updateTrackMixer(trackId, patch);
        if (typeof patch?.volume === 'number') {
            audioEngine.setTrackVolume(trackId, patch.volume);
        }
    }
});

const recorder = new Recorder({
    audioEngine,
    playlist
});

function stopTransportLoop() {
    if (transportRafId) {
        window.cancelAnimationFrame(transportRafId);
        transportRafId = 0;
    }
}

function refreshPlayheadFromTransport() {
    if (!isPlaying) {
        stopTransportLoop();
        return;
    }

    const elapsed = audioEngine.getCurrentTime() - playbackStartCtxTime;
    const timelinePosition = Math.max(0, playbackOffset + elapsed);
    playlist.setPlayheadTime(timelinePosition);

    const projectDuration = playlist.getProjectDuration();
    if (timelinePosition >= projectDuration && projectDuration > 0) {
        stopPlayback();
        return;
    }

    transportRafId = window.requestAnimationFrame(refreshPlayheadFromTransport);
}

async function ensureAudioReady() {
    await audioEngine.init();
}

function refreshPlayPauseIcon() {
    if (!playPauseIcon) {
        return;
    }

    playPauseIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

function refreshRecordArmVisual() {
    if (!recordButton) {
        return;
    }

    recordButton.classList.toggle('is-recording', isRecordArmed);
    recordButton.classList.toggle('is-armed', isRecordArmed);
    recordButton.setAttribute('aria-pressed', isRecordArmed ? 'true' : 'false');
}

function finalizeRecordingClip() {
    if (!recorder.isRecording) {
        return null;
    }

    playlist.setPlayheadTime(recordStartPlayhead);
    return recorder.stop();
}

function disarmRecording() {
    isRecordArmed = false;
    refreshRecordArmVisual();
}

async function startPlayback() {
    if (isPlaying) {
        return;
    }

    try {
        await ensureAudioReady();
        playbackOffset = playlist.getPlayheadTime();

        if (isRecordArmed && !recorder.isRecording) {
            recordStartPlayhead = playbackOffset;
            recorder.start();
            setStatus('Record armed: felvetel indult lejatszaskor');
        }

        audioEngine.playPlaylist(projectState.tracks, playbackOffset);
        isPlaying = true;
        playbackStartCtxTime = audioEngine.getCurrentTime();
        setStatus(`Audio allapot: ${audioEngine.getState()} | lejatszas`);
        refreshPlayPauseIcon();
        stopTransportLoop();
        transportRafId = window.requestAnimationFrame(refreshPlayheadFromTransport);
    } catch (error) {
        setStatus(`Lejatszas hiba: ${error.message}`, true);
    }
}

function pausePlayback() {
    if (!isPlaying) {
        return;
    }

    if (recorder.isRecording) {
        stopPlayback();
        return;
    }

    const elapsed = audioEngine.getCurrentTime() - playbackStartCtxTime;
    playbackOffset = Math.max(0, playbackOffset + elapsed);
    isPlaying = false;
    audioEngine.stopScheduledPlayback();
    stopTransportLoop();
    playlist.setPlayheadTime(playbackOffset);
    setStatus(`Audio allapot: ${audioEngine.getState()} | pause ${playbackOffset.toFixed(2)}s`);
    refreshPlayPauseIcon();
}

function stopPlayback() {
    isPlaying = false;

    let recordedClip = null;
    if (recorder.isRecording) {
        recordedClip = finalizeRecordingClip();
        disarmRecording();
    }

    playbackOffset = 0;
    audioEngine.stopScheduledPlayback();
    stopTransportLoop();
    playlist.setPlayheadTime(0);

    if (recordedClip) {
        setStatus(`Felvetel kesz: ${recordedClip.name} (${recordedClip.duration.toFixed(2)}s)`);
    } else {
        setStatus(`Audio allapot: ${audioEngine.getState()} | stop`);
    }

    refreshPlayPauseIcon();
}

function togglePlayPause() {
    if (isPlaying) {
        pausePlayback();
        return;
    }

    startPlayback();
}

function toggleMixerDrawer() {
    if (!mixerDrawer) {
        return;
    }

    const isOpen = mixerDrawer.classList.toggle('open');
    mixerDrawer.classList.toggle('is-open', isOpen);
}

function closeInstrumentDrawers() {
    drumpadDrawer?.classList.remove('open');
    pianoDrawer?.classList.remove('open');
}

function toggleLibraryDrawer() {
    if (!libraryDrawer) {
        return;
    }

    const willOpen = !libraryDrawer.classList.contains('open');
    libraryDrawer.classList.toggle('open', willOpen);

    if (!willOpen) {
        if (samplePickerRequest) {
            clearSamplePicker();
        }
        return;
    }

    refreshSampleLibrary().catch((error) => {
        setStatus(`Library hiba: ${error.message}`, true);
    });
}

function getLibraryHeaderElement() {
    return document.querySelector('.library-header strong');
}

function updateLibraryHeader() {
    const headerEl = getLibraryHeaderElement();
    if (!headerEl) {
        return;
    }

    if (samplePickerRequest?.label) {
        headerEl.textContent = `Sample Library | Pick: ${samplePickerRequest.label}`;
        return;
    }

    headerEl.textContent = 'Sample Library';
}

function closeProjectMenu() {
    projectDropdown?.classList.remove('show');
    projectMenu?.classList.remove('show');
    projectMenuButton?.setAttribute('aria-expanded', 'false');
}

function toggleProjectMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    const willOpen = !projectMenu?.classList.contains('show');
    closeProjectMenu();

    if (willOpen) {
        projectDropdown?.classList.add('show');
        projectMenu?.classList.add('show');
        projectMenuButton?.setAttribute('aria-expanded', 'true');
    }
}

async function renderSampleLibrary() {
    if (!libraryUI) {
        return;
    }

    const samples = await db.listSamples();
    libraryUI.setSamples(samples);
}

async function refreshSampleLibrary() {
    updateLibraryHeader();
    await renderSampleLibrary();
}

function isAudioFile(file) {
    if (!file) {
        return false;
    }

    if (String(file.type || '').startsWith('audio/')) {
        return true;
    }

    return /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff|opus)$/i.test(file.name || '');
}

function getFileRelativePath(file) {
    const rawPath = file?.webkitRelativePath || file?.name || 'sample';
    return String(rawPath)
        .replace(/^\.+[\/\\]+/, '')
        .replace(/[\\]+/g, '/')
        .replace(/\/+/g, '/');
}

async function importSamplesFromFileList(fileList) {
    const files = Array.from(fileList || []).filter(isAudioFile);
    if (files.length === 0) {
        setStatus('Nincs importalhato audio file.', true);
        return;
    }

    let importedCount = 0;
    const failures = [];

    for (const file of files) {
        try {
            await sampleStore.saveFile(file, {
                category: 'audio',
                relativePath: getFileRelativePath(file)
            });
            importedCount += 1;
        } catch (error) {
            failures.push(`${file.name}: ${error.message}`);
        }
    }

    if (libraryDrawer?.classList.contains('open')) {
        await refreshSampleLibrary();
    }

    if (failures.length > 0) {
        setStatus(`Import reszben sikeres: ${importedCount}/${files.length}`, true);
        return;
    }

    setStatus(`Import kesz: ${importedCount} minta`);
}

function clearSamplePicker() {
    samplePickerRequest = null;
    libraryUI?.setPickerMode(null);
    updateLibraryHeader();
}

async function openSamplePicker(request) {
    samplePickerRequest = request;
    libraryUI?.setPickerMode({ label: request?.label || 'Sample' });
    updateLibraryHeader();
    libraryDrawer?.classList.add('open');
    await refreshSampleLibrary();
}

function applyLoadedProject(nextState) {
    const normalized = normalizeProjectState(nextState);

    projectState.bpm = normalized.bpm;
    projectState.playheadTime = normalized.playheadTime;
    projectState.activeTrackId = normalized.activeTrackId;
    projectState.tracks = normalized.tracks;
    projectState.presets = normalized.presets;

    updateBpm(projectState.bpm);
    playlist.setProjectData({
        tracks: projectState.tracks,
        activeTrackId: projectState.activeTrackId,
        playheadTime: projectState.playheadTime
    });

    mixer.render(projectState.tracks, projectState.activeTrackId);
    syncActiveTrackIndex();
    refreshHeaderTrackSelect();
    syncInstrumentsFromActiveTrack();
    closeClipMenusAndOverlays();
    schedulePersist();
}

function closeClipMenusAndOverlays() {
    drumpadDrawer?.classList.remove('open');
    pianoDrawer?.classList.remove('open');
}

async function saveProjectToDb() {
    const defaultName = `Project_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    const projectName = window.prompt('Projekt neve:', defaultName);
    if (!projectName) {
        return;
    }

    const saved = await db.saveProject(projectName, projectState);
    setStatus(`Projekt mentve: ${saved.name}`);
}

async function loadProjectFromDb() {
    const projects = await db.listProjects();
    if (projects.length === 0) {
        setStatus('Nincs mentett projekt.', true);
        return;
    }

    const options = projects
        .map((project, index) => `${index + 1}. ${project.name}`)
        .join('\n');
    const selection = window.prompt(`Valassz projektet (sorszam):\n${options}`, '1');
    if (!selection) {
        return;
    }

    const index = Number(selection) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
        setStatus('Ervenytelen projekt valasztas.', true);
        return;
    }

    const record = await db.loadProject(projects[index].id);
    if (!record?.data) {
        setStatus('A projekt adat nem olvashato.', true);
        return;
    }

    applyLoadedProject(record.data);
    setStatus(`Projekt betoltve: ${record.name}`);
}

function toggleDrumpadDrawer() {
    if (!drumpadDrawer) {
        return;
    }

    const willOpen = !drumpadDrawer.classList.contains('open');
    closeInstrumentDrawers();
    if (willOpen) {
        drumpadDrawer.classList.add('open');
    }
}

function togglePianoDrawer() {
    if (!pianoDrawer) {
        return;
    }

    const willOpen = !pianoDrawer.classList.contains('open');
    closeInstrumentDrawers();
    if (willOpen) {
        pianoDrawer.classList.add('open');
    }
}

async function toggleRecord() {
    if (recorder.isRecording) {
        stopPlayback();
        return;
    }

    isRecordArmed = !isRecordArmed;
    refreshRecordArmVisual();
    setStatus(isRecordArmed ? 'Record armed' : 'Record disarmed');
}

function syncBpmInputs(value) {
    bpmNumber.value = String(value);
}

function updateBpm(value) {
    const bpm = Math.min(240, Math.max(40, Number(value) || 120));
    syncBpmInputs(bpm);
    audioEngine.setBpm(bpm);
    projectState.bpm = bpm;
    schedulePersist();
}

function commitBpmInput() {
    const entered = Number(bpmNumber?.value);
    updateBpm(Number.isFinite(entered) ? entered : projectState.bpm || 120);
}

function changeBpm(delta) {
    const current = Number(bpmNumber?.value || projectState.bpm || 120);
    updateBpm(current + delta);
}

async function exportWav() {
    try {
        if (menuExportWav) {
            menuExportWav.classList.add('disabled');
            menuExportWav.setAttribute('aria-disabled', 'true');
        }
        setStatus('Export folyamatban...');
        const wavBlob = await audioEngine.exportToWav(projectState.tracks, projectState.bpm);
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');

        link.href = url;
        link.download = `mini-daw-${stamp}.wav`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        setStatus('WAV export kesz');
    } catch (error) {
        setStatus(`Export hiba: ${error.message}`, true);
    } finally {
        if (menuExportWav) {
            menuExportWav.classList.remove('disabled');
            menuExportWav.removeAttribute('aria-disabled');
        }
    }
}

async function toggleMetronome() {
    try {
        await ensureAudioReady();

        if (audioEngine.isMetronomeRunning()) {
            audioEngine.stopMetronome();
            metronomeButton?.classList.remove('is-active');
            setStatus(`Audio allapot: ${audioEngine.getState()} | metronom leallitva`);
            return;
        }

        audioEngine.startMetronome();
        metronomeButton?.classList.add('is-active');
        setStatus(`Audio allapot: ${audioEngine.getState()} | metronom fut`);
    } catch (error) {
        setStatus(`Audio hiba: ${error.message}`, true);
    }
}

libraryUI = initLibraryUI({
    container: libraryList,
    onStatusChange: setStatus,
    onPreviewSample: async (sample) => {
        await ensureAudioReady();
        const blob = await db.getBlob(sample.id);
        if (!blob) {
            throw new Error('A minta nem talalhato.');
        }

        const buffer = await audioEngine.decodeAudioData(await blob.arrayBuffer());
        audioEngine.playBuffer(buffer, { volume: 0.85 });
    },
    onDeleteSample: async (sample) => {
        await db.deleteSample(sample.id);
        await refreshSampleLibrary();
    },
    onPickSample: async (sample) => {
        if (!samplePickerRequest?.onPick) {
            return;
        }

        const pickRequest = samplePickerRequest;
        clearSamplePicker();
        libraryDrawer?.classList.remove('open');
        await pickRequest.onPick(sample);
    }
});

drumpadUI = initDrumpad({
    container: drumpadContainer,
    audioEngine,
    ensureAudioReady,
    sampleStore,
    onStatusChange: setStatus,
    listPresets: () => projectState.presets.drumpad,
    onSavePreset: (presetName, presetPayload) => {
        const saved = addDrumpadPreset(projectState, presetName, presetPayload);
        const activeTrack = getActiveTrack();
        if (activeTrack) {
            activeTrack.preset.drumpad = cloneDrumpadPreset(saved);
        }
        schedulePersist();
        return saved;
    },
    onPadPresetChange: (nextPreset) => {
        const activeTrack = getActiveTrack();
        if (!activeTrack) {
            return;
        }

        ensureTrackPreset(activeTrack);
        activeTrack.preset.drumpad = cloneDrumpadPreset(nextPreset);
        schedulePersist();
    },
    onRequestSamplePick: ({ label, onPick }) => {
        openSamplePicker({ label, onPick }).catch((error) => {
            setStatus(`Picker hiba: ${error.message}`, true);
        });
    },
    onTrigger: (eventData) => recorder.captureEvent(eventData)
});

pianoUI = initPiano({
    container: pianoContainer,
    audioEngine,
    ensureAudioReady,
    sampleStore,
    onStatusChange: setStatus,
    listPresets: () => projectState.presets.synth,
    onSavePreset: (presetName, presetPayload) => {
        const saved = addSynthPresetToState(presetName, presetPayload);
        const activeTrack = getActiveTrack();
        if (activeTrack) {
            activeTrack.preset.synth = cloneSynthPreset(saved);
        }
        schedulePersist();
        return saved;
    },
    onOverwritePreset: (presetId, presetPayload) => {
        const updated = overwriteSynthPresetInState(presetId, presetPayload);
        if (!updated) {
            return null;
        }

        const activeTrack = getActiveTrack();
        if (activeTrack) {
            activeTrack.preset.synth = cloneSynthPreset(updated);
        }
        schedulePersist();
        return updated;
    },
    onSynthPresetChange: (nextPreset) => {
        const activeTrack = getActiveTrack();
        if (!activeTrack) {
            return;
        }

        ensureTrackPreset(activeTrack);
        activeTrack.preset.synth = cloneSynthPreset(nextPreset);
        schedulePersist();
    },
    onRequestSamplePick: ({ label, onPick }) => {
        openSamplePicker({ label, onPick }).catch((error) => {
            setStatus(`Picker hiba: ${error.message}`, true);
        });
    },
    onTrigger: (eventData) => recorder.captureEvent(eventData)
});

metronomeButton?.addEventListener('click', toggleMetronome);
testToneButton?.addEventListener('click', async () => {
    try {
        await ensureAudioReady();
        audioEngine.playTone(440, 'sawtooth', 0.6);
        setStatus(`Audio allapot: ${audioEngine.getState()} | teszt hang lejatszva`);
    } catch (error) {
        setStatus(`Audio hiba: ${error.message}`, true);
    }
});

playPauseButton?.addEventListener('click', togglePlayPause);
stopButton?.addEventListener('click', stopPlayback);
recordButton?.addEventListener('click', toggleRecord);
toggleMixerButton?.addEventListener('click', toggleMixerDrawer);
toggleDrumpadButton?.addEventListener('click', toggleDrumpadDrawer);
togglePianoButton?.addEventListener('click', togglePianoDrawer);
toggleLibraryButton?.addEventListener('click', toggleLibraryDrawer);
projectMenuButton?.addEventListener('click', toggleProjectMenu);
menuImportFile?.addEventListener('click', (event) => {
    event.preventDefault();
    closeProjectMenu();
    hiddenSampleInput?.click();
});
menuImportFolder?.addEventListener('click', (event) => {
    event.preventDefault();
    closeProjectMenu();
    hiddenFolderInput?.click();
});
menuSaveProject?.addEventListener('click', (event) => {
    event.preventDefault();
    closeProjectMenu();
    saveProjectToDb().catch((error) => {
        setStatus(`Projekt mentesi hiba: ${error.message}`, true);
    });
});
menuLoadProject?.addEventListener('click', (event) => {
    event.preventDefault();
    closeProjectMenu();
    loadProjectFromDb().catch((error) => {
        setStatus(`Projekt betoltesi hiba: ${error.message}`, true);
    });
});
menuExportWav?.addEventListener('click', (event) => {
    event.preventDefault();
    closeProjectMenu();
    exportWav();
});

hiddenSampleInput?.addEventListener('change', (event) => {
    importSamplesFromFileList(event.target.files).catch((error) => {
        setStatus(`Import hiba: ${error.message}`, true);
    }).finally(() => {
        event.target.value = '';
    });
});

hiddenFolderInput?.addEventListener('change', (event) => {
    importSamplesFromFileList(event.target.files).catch((error) => {
        setStatus(`Folder import hiba: ${error.message}`, true);
    }).finally(() => {
        event.target.value = '';
    });
});

document.addEventListener('click', (event) => {
    if (!projectDropdown || projectDropdown.contains(event.target)) {
        return;
    }

    closeProjectMenu();
});

headerTrackSelect?.addEventListener('change', (event) => {
    const trackId = event.target.value;
    if (!trackId || !projectState.tracks.some((track) => track.id === trackId)) {
        return;
    }

    playlist.selectTrack(trackId);
    projectState.activeTrackId = trackId;
    syncActiveTrackIndex();
    refreshHeaderTrackSelect();
    syncInstrumentsFromActiveTrack();
    schedulePersist();
});

toolbarAddTrackButton?.addEventListener('click', () => {
    const activeType = getActiveTrack()?.type || 'drumpad';
    playlist.addTrack(activeType);
});

toolbarRemoveTrackButton?.addEventListener('click', () => {
    playlist.removeActiveTrack();
});

toolbarSplitButton?.addEventListener('click', () => {
    playlist.splitSelectedClip();
});

bpmNumber?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
        return;
    }

    event.preventDefault();
    commitBpmInput();
    bpmNumber.blur();
});

bpmNumber?.addEventListener('change', commitBpmInput);
bpmNumber?.addEventListener('blur', commitBpmInput);

bpmDecreaseButton?.addEventListener('click', () => changeBpm(-1));
bpmIncreaseButton?.addEventListener('click', () => changeBpm(1));

document.addEventListener('pointerdown', () => {
    ensureAudioReady().catch(() => {
        setStatus('Audio hiba: nem sikerult aktivalni a hangmotort.', true);
    });
}, { once: true, passive: true });

updateBpm(projectState.bpm || 120);
setStatus('Audio allapot: inaktiv');
refreshPlayPauseIcon();
refreshRecordArmVisual();
mixer.render(projectState.tracks, projectState.activeTrackId);
syncActiveTrackIndex();
refreshHeaderTrackSelect();
syncInstrumentsFromActiveTrack();

db.open().catch(() => {
    setStatus('IndexedDB inicializalas sikertelen.', true);
});
