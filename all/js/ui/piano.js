import { cloneSynthPreset, createSynthPreset } from '../state.js';

const WHITE_KEYS_PER_RANGE = 14;
const OCTAVE_COUNT = 2;
const MIN_BASE_OCTAVE = 2;
const MAX_BASE_OCTAVE = 4;
const KEYBOARD_SHORTCUTS = {
    a: 0,
    w: 1,
    s: 2,
    e: 3,
    d: 4,
    f: 5,
    t: 6,
    g: 7,
    y: 8,
    h: 9,
    u: 10,
    j: 11
};

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const OCTAVE_PATTERN = [
    { semitone: 0, isBlack: false },
    { semitone: 1, isBlack: true, whiteBoundaryUnit: 1 },
    { semitone: 2, isBlack: false },
    { semitone: 3, isBlack: true, whiteBoundaryUnit: 2 },
    { semitone: 4, isBlack: false },
    { semitone: 5, isBlack: false },
    { semitone: 6, isBlack: true, whiteBoundaryUnit: 4 },
    { semitone: 7, isBlack: false },
    { semitone: 8, isBlack: true, whiteBoundaryUnit: 5 },
    { semitone: 9, isBlack: false },
    { semitone: 10, isBlack: true, whiteBoundaryUnit: 6 },
    { semitone: 11, isBlack: false }
];

function midiToFrequency(midi) {
    return 440 * (2 ** ((midi - 69) / 12));
}

function midiToNoteId(midi) {
    const note = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
}

function buildKeyLayout() {
    const keys = [];
    let idCounter = 0;

    for (let octaveIndex = 0; octaveIndex < OCTAVE_COUNT; octaveIndex += 1) {
        const semitoneOffset = octaveIndex * 12;
        const whiteOffset = octaveIndex * 7;

        OCTAVE_PATTERN.forEach((entry) => {
            const key = {
                id: `k-${idCounter}`,
                relSemitone: semitoneOffset + entry.semitone,
                isBlack: entry.isBlack,
                anchor: null
            };

            if (entry.isBlack) {
                key.anchor = ((entry.whiteBoundaryUnit + whiteOffset) / WHITE_KEYS_PER_RANGE) * 100;
            }

            keys.push(key);
            idCounter += 1;
        });
    }

    return keys;
}

const KEY_LAYOUT = buildKeyLayout();

export function initPiano({
    container,
    audioEngine,
    ensureAudioReady,
    sampleStore,
    onStatusChange,
    onTrigger,
    onSynthPresetChange,
    listPresets,
    onSavePreset,
    onOverwritePreset,
    onRequestSamplePick
}) {
    if (!container || !audioEngine || !ensureAudioReady) {
        return null;
    }

    let activePreset = createSynthPreset('Init Synth');
    const keyElements = new Map();
    let waveformSelect = null;
    let presetSelect = null;
    let octaveDisplay = null;
    let baseOctave = 3;

    container.innerHTML = '';

    const controls = document.createElement('div');
    controls.className = 'piano-toolbar';

    const octDownButton = document.createElement('button');
    octDownButton.type = 'button';
    octDownButton.textContent = 'Oct -';

    octaveDisplay = document.createElement('button');
    octaveDisplay.type = 'button';
    octaveDisplay.className = 'octave-display';
    octaveDisplay.textContent = 'C3-C5';
    octaveDisplay.disabled = true;

    const octUpButton = document.createElement('button');
    octUpButton.type = 'button';
    octUpButton.textContent = 'Oct +';

    const waveformLabel = document.createElement('label');
    waveformLabel.className = 'waveform-select';

    waveformSelect = document.createElement('select');
    waveformSelect.setAttribute('aria-label', 'Hullamforma valaszto');

    WAVEFORMS.forEach((waveform) => {
        const option = document.createElement('option');
        option.value = waveform;
        option.textContent = waveform;
        waveformSelect.appendChild(option);
    });

    waveformSelect.addEventListener('change', (event) => {
        activePreset.waveform = event.target.value;
        onSynthPresetChange?.(getCurrentPreset());
    });

    waveformLabel.appendChild(waveformSelect);

    presetSelect = document.createElement('select');
    presetSelect.className = 'synth-preset-select';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';

    const saveAsNewButton = document.createElement('button');
    saveAsNewButton.type = 'button';
    saveAsNewButton.textContent = 'Save As New';

    const pickSampleButton = document.createElement('button');
    pickSampleButton.type = 'button';
    pickSampleButton.className = 'piano-pick-sample-btn';
    pickSampleButton.innerHTML = '<i class="fas fa-hand-pointer" aria-hidden="true"></i> Pick Sample';

    controls.append(octDownButton, octaveDisplay, octUpButton, waveformLabel, presetSelect, saveButton, saveAsNewButton, pickSampleButton);

    const keyboard = document.createElement('div');
    keyboard.className = 'piano-keyboard';

    const whiteRow = document.createElement('div');
    whiteRow.className = 'white-keys';

    const blackRow = document.createElement('div');
    blackRow.className = 'black-keys';

    KEY_LAYOUT.forEach((noteLayout) => {
        const key = document.createElement('button');
        const isBlack = noteLayout.isBlack;
        key.type = 'button';
        key.className = `piano-key ${isBlack ? 'black' : 'white'}`;
        key.dataset.keyId = noteLayout.id;
        key.dataset.relSemitone = String(noteLayout.relSemitone);
        key.setAttribute('aria-label', 'Piano key');

        key.addEventListener('pointerdown', () => {
            playNote(noteLayout);
        });

        keyElements.set(noteLayout.id, key);

        if (isBlack) {
            key.style.left = `${noteLayout.anchor}%`;
            blackRow.appendChild(key);
        } else {
            whiteRow.appendChild(key);
        }
    });

    keyboard.append(whiteRow, blackRow);
    container.append(controls, keyboard);

    function syncRangeDisplay() {
        if (!octaveDisplay) {
            return;
        }

        octaveDisplay.textContent = `C${baseOctave}-C${baseOctave + 2}`;
    }

    syncRangeDisplay();

    octDownButton.addEventListener('click', () => {
        baseOctave = Math.max(MIN_BASE_OCTAVE, baseOctave - 1);
        syncRangeDisplay();
    });

    octUpButton.addEventListener('click', () => {
        baseOctave = Math.min(MAX_BASE_OCTAVE, baseOctave + 1);
        syncRangeDisplay();
    });

    saveButton.addEventListener('click', () => {
        const selectedPresetId = presetSelect.value || activePreset.id;
        const currentName = (activePreset.name || 'Init Synth').trim() || 'Init Synth';
        const updated = {
            ...getCurrentPreset(),
            id: selectedPresetId,
            name: currentName,
            kind: 'synth'
        };
        onOverwritePreset?.(selectedPresetId, updated);
        applySynthPreset(updated);
        refreshPresetList(selectedPresetId);
        onStatusChange?.(`Synth preset frissitve: ${updated.name}`);
    });

    saveAsNewButton.addEventListener('click', () => {
        const baseName = activePreset.name || 'Init Synth';
        const nextName = window.prompt('Uj synth preset neve:', `${baseName}_1`);
        if (!nextName) {
            return;
        }

        const saved = onSavePreset?.(nextName, getCurrentPreset());
        if (!saved) {
            return;
        }

        applySynthPreset(saved);
        refreshPresetList(saved.id);
        onSynthPresetChange?.(getCurrentPreset());
        onStatusChange?.(`Uj synth preset mentve: ${saved.name}`);
    });

    presetSelect.addEventListener('change', () => {
        const presetId = presetSelect.value;
        const allPresets = listPresets?.() || [];
        const selected = allPresets.find((preset) => preset.id === presetId);
        if (!selected) {
            return;
        }

        applySynthPreset(selected);
        onSynthPresetChange?.(getCurrentPreset());
        onStatusChange?.(`Synth preset betoltve: ${selected.name}`);
    });

    pickSampleButton.addEventListener('click', () => {
        if (!onRequestSamplePick) {
            return;
        }

        onRequestSamplePick({
            label: 'Synth',
            onPick: async (sample) => {
                await ensureAudioReady();
                const blob = await sampleStore?.getBlob(sample.id);
                if (!blob) {
                    throw new Error('A minta nem talalhato.');
                }

                activePreset.sampleBuffer = await audioEngine.decodeAudioData(await blob.arrayBuffer());
                activePreset.sampleId = sample.id;
                activePreset.sampleName = sample.relativePath || sample.name || '';
                activePreset.sampleDataUrl = '';
                onSynthPresetChange?.(getCurrentPreset());
                onStatusChange?.(`Synth minta kivalasztva: ${activePreset.sampleName}`);
            }
        });
    });

    async function ensureSampleBuffer() {
        if (activePreset.sampleBuffer) {
            return activePreset.sampleBuffer;
        }

        if (activePreset.sampleId && sampleStore) {
            const blob = await sampleStore.getBlob(activePreset.sampleId);
            if (blob) {
                activePreset.sampleBuffer = await audioEngine.decodeAudioData(await blob.arrayBuffer());
                return activePreset.sampleBuffer;
            }
        }

        if (activePreset.sampleDataUrl) {
            const response = await fetch(activePreset.sampleDataUrl);
            const arrayBuffer = await response.arrayBuffer();
            activePreset.sampleBuffer = await audioEngine.decodeAudioData(arrayBuffer);
            return activePreset.sampleBuffer;
        }

        return null;
    }

    async function playNote(noteLayout) {
        const midi = ((baseOctave + 1) * 12) + noteLayout.relSemitone;
        const freq = midiToFrequency(midi);
        const noteId = midiToNoteId(midi);

        try {
            await ensureAudioReady();
            const sampleBuffer = await ensureSampleBuffer();

            if (sampleBuffer) {
                const rootFreq = activePreset.rootFreq || 261.63;
                const playbackRate = freq / rootFreq;
                audioEngine.playBuffer(sampleBuffer, { playbackRate, volume: 0.95 });
                onTrigger?.({
                    source: 'piano',
                    note: noteId,
                    kind: 'sample',
                    duration: Math.max(0.1, sampleBuffer.duration / playbackRate),
                    velocity: 1
                });
            } else {
                const duration = Math.max(0.05, activePreset.release || 0.35) + 0.1;
                audioEngine.playTone(freq, activePreset.waveform || 'sine', duration);
                onTrigger?.({
                    source: 'piano',
                    note: noteId,
                    label: noteId,
                    kind: 'tone',
                    frequency: freq,
                    waveType: activePreset.waveform || 'sine',
                    duration
                });
            }

            pulseKey(noteLayout.id);
            onStatusChange?.(`Piano: ${noteId}`);
        } catch (error) {
            onStatusChange?.(`Piano hiba: ${error.message}`, true);
        }
    }

    function pulseKey(keyId) {
        const keyElement = keyElements.get(keyId);
        if (!keyElement) {
            return;
        }

        keyElement.classList.add('is-active');
        window.setTimeout(() => keyElement.classList.remove('is-active'), 120);
    }

    function onKeyDown(event) {
        if (event.repeat) {
            return;
        }

        const keyName = event.key.toLowerCase();
        const relSemitone = KEYBOARD_SHORTCUTS[keyName];
        if (typeof relSemitone !== 'number') {
            return;
        }

        const note = KEY_LAYOUT.find((entry) => entry.relSemitone === relSemitone);

        if (!note) {
            return;
        }

        playNote(note);
    }

    function applySynthPreset(preset) {
        activePreset = cloneSynthPreset(preset);
        if (waveformSelect) {
            waveformSelect.value = activePreset.waveform || 'sine';
        }
        refreshPresetList(activePreset.id);
    }

    function getCurrentPreset() {
        return cloneSynthPreset(activePreset);
    }

    function refreshPresetList(selectPresetId = null) {
        if (!presetSelect) {
            return;
        }

        const allPresets = listPresets?.() || [];
        presetSelect.innerHTML = '';
        allPresets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            if (selectPresetId && preset.id === selectPresetId) {
                option.selected = true;
            }
            presetSelect.appendChild(option);
        });
    }

    window.addEventListener('keydown', onKeyDown);

    refreshPresetList(activePreset.id);
    applySynthPreset(activePreset);

    return {
        applySynthPreset,
        getCurrentPreset,
        refreshPresetList
    };
}
