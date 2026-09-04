import { cloneDrumpadPreset, createDrumpadPreset } from '../state.js';

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];

async function dataUrlToAudioBuffer(dataUrl, audioEngine) {
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    return audioEngine.decodeAudioData(arrayBuffer);
}

export function initDrumpad({
    container,
    audioEngine,
    ensureAudioReady,
    sampleStore,
    onStatusChange,
    onTrigger,
    listPresets,
    onSavePreset,
    onPadPresetChange,
    onRequestSamplePick
}) {
    if (!container || !audioEngine || !ensureAudioReady) {
        return null;
    }

    const state = {
        activePreset: createDrumpadPreset('Default Kit'),
        pads: [],
        presetSelect: null,
        presetNameInput: null,
        editMode: false,
        editButton: null,
        drawerEl: document.querySelector('#drumpad-drawer'),
        popup: null,
        popupTitle: null,
        popupSourceSelect: null,
        popupPickButton: null,
        popupGainInput: null,
        popupGainValue: null,
        editingPadIndex: -1
    };

    container.classList.remove('placeholder-grid');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'drumpad-header';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'drumpad-edit-toggle';
    editButton.title = 'Edit mod';
    editButton.setAttribute('aria-pressed', 'false');
    editButton.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i>';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'preset-name-input drumpad-edit-only';
    nameInput.placeholder = 'Preset nev (pl. 808 Kit)';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'drumpad-edit-only';
    saveButton.textContent = 'Save';

    const select = document.createElement('select');
    select.className = 'preset-select drumpad-kit-select';

    const saveAsNewButton = document.createElement('button');
    saveAsNewButton.type = 'button';
    saveAsNewButton.className = 'drumpad-edit-only';
    saveAsNewButton.textContent = 'Save As New';

    const headerSpacer = document.createElement('div');
    headerSpacer.className = 'drumpad-header-spacer';

    header.append(editButton, select, headerSpacer, nameInput, saveButton, saveAsNewButton);

    const grid = document.createElement('div');
    grid.className = 'drumpad-grid';

    for (let index = 0; index < PAD_KEYS.length; index += 1) {
        const card = document.createElement('article');
        card.className = 'pad-card';

        const triggerButton = document.createElement('button');
        triggerButton.type = 'button';
        triggerButton.className = 'pad-trigger';
        triggerButton.setAttribute('aria-label', `Pad ${index + 1}`);

        card.append(triggerButton);

        grid.appendChild(card);

        const padState = {
            index,
            button: triggerButton,
            padData: null
        };
        state.pads.push(padState);

        triggerButton.addEventListener('pointerdown', () => {
            if (state.editMode) {
                openPadEditor(index);
                return;
            }

            triggerPad(index);
        });
    }

    const popupOverlay = document.createElement('div');
    popupOverlay.className = 'drumpad-popup-overlay';

    const popup = document.createElement('div');
    popup.className = 'drumpad-pad-popup';

    const popupHeader = document.createElement('div');
    popupHeader.className = 'drumpad-pad-popup-header';

    const popupTitle = document.createElement('strong');
    popupTitle.textContent = 'Pad';

    const popupClose = document.createElement('button');
    popupClose.type = 'button';
    popupClose.className = 'drumpad-popup-close';
    popupClose.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

    popupHeader.append(popupTitle, popupClose);

    const popupSourceSelect = document.createElement('select');
    popupSourceSelect.className = 'pad-source-select';
    popupSourceSelect.innerHTML = `
        <option value="sample">Sample</option>
        <option value="tone">Tone</option>
    `;

    const popupPickButton = document.createElement('button');
    popupPickButton.type = 'button';
    popupPickButton.className = 'pad-pick-button';
    popupPickButton.innerHTML = '<i class="fas fa-hand-pointer" aria-hidden="true"></i> Pick Sample';

    const popupGainInput = document.createElement('input');
    popupGainInput.type = 'range';
    popupGainInput.className = 'pad-gain-input';
    popupGainInput.min = '0';
    popupGainInput.max = '100';
    popupGainInput.step = '1';

    const popupGainValue = document.createElement('small');
    popupGainValue.className = 'pad-gain-value';

    popup.append(popupHeader, popupSourceSelect, popupPickButton, popupGainInput, popupGainValue);
    popupOverlay.appendChild(popup);

    popupClose.addEventListener('click', closePadEditor);
    popupOverlay.addEventListener('pointerdown', (event) => {
        if (event.target === popupOverlay) {
            closePadEditor();
        }
    });

    popupSourceSelect.addEventListener('change', () => {
        const targetPad = getEditingPad();
        if (!targetPad) {
            return;
        }

        targetPad.sourceMode = popupSourceSelect.value === 'tone' ? 'tone' : 'sample';
        onPadPresetChange?.(getCurrentPreset());
    });

    popupGainInput.addEventListener('input', () => {
        const targetPad = getEditingPad();
        if (!targetPad) {
            return;
        }

        targetPad.gain = Math.min(1, Math.max(0, Number(popupGainInput.value) / 100));
        popupGainValue.textContent = `${Math.round(targetPad.gain * 100)}%`;
        onPadPresetChange?.(getCurrentPreset());
    });

    popupPickButton.addEventListener('click', async () => {
        const targetPad = getEditingPad();
        if (!targetPad || !onRequestSamplePick) {
            return;
        }

        onRequestSamplePick({
            label: `Pad ${state.editingPadIndex + 1}`,
            onPick: async (sample) => {
                await ensureAudioReady();
                const blob = await sampleStore?.getBlob(sample.id);
                if (!blob) {
                    throw new Error('A minta nem talalhato.');
                }

                const audioBuffer = await audioEngine.decodeAudioData(await blob.arrayBuffer());
                targetPad.sampleBuffer = audioBuffer;
                targetPad.sampleName = sample.relativePath || sample.name;
                targetPad.sampleId = sample.id;
                targetPad.sampleDataUrl = '';
                targetPad.sourceMode = 'sample';

                popupSourceSelect.value = 'sample';
                syncPadVisual(state.editingPadIndex);
                onPadPresetChange?.(getCurrentPreset());
                onStatusChange?.(`Drumpad: ${targetPad.name} minta frissitve`);
            }
        });
    });

    saveButton.addEventListener('click', () => {
        const allPresets = listPresets?.() || [];
        const selectedPresetId = select.value || state.activePreset.id;
        const targetIndex = allPresets.findIndex((preset) => preset.id === selectedPresetId);

        if (targetIndex < 0) {
            onStatusChange?.('Nincs kivalasztott preset mentesehez.', true);
            return;
        }

        const targetName = (nameInput.value.trim() || state.activePreset.name || allPresets[targetIndex].name || 'Untitled Kit');
        const nextPreset = {
            ...cloneDrumpadPreset(getCurrentPreset()),
            id: allPresets[targetIndex].id,
            name: targetName,
            kind: 'drumpad'
        };

        allPresets[targetIndex] = nextPreset;
        applyPreset(nextPreset);
        onPadPresetChange?.(nextPreset);
        refreshPresetList(nextPreset.id);
        onStatusChange?.(`Preset felulirva: ${nextPreset.name}`);
    });

    saveAsNewButton.addEventListener('click', () => {
        const baseName = state.activePreset.name || 'Untitled Kit';
        const defaultName = `${baseName}_1`;
        const nextName = window.prompt('Uj preset neve:', defaultName);
        if (!nextName) {
            return;
        }

        const saved = onSavePreset?.(nextName, getCurrentPreset());
        if (!saved) {
            return;
        }

        applyPreset(saved);
        onPadPresetChange?.(saved);
        refreshPresetList(saved.id);
        onStatusChange?.(`Uj preset mentve: ${saved.name}`);
    });

    select.addEventListener('change', () => {
        const presetId = select.value;
        const allPresets = listPresets?.() || [];
        const target = allPresets.find((preset) => preset.id === presetId);
        if (!target) {
            return;
        }

        applyPreset(target);
        onPadPresetChange?.(getCurrentPreset());
        onStatusChange?.(`Preset betoltve: ${target.name}`);
    });

    editButton.addEventListener('click', () => {
        state.editMode = !state.editMode;
        syncEditModeUi();
    });

    state.presetSelect = select;
    state.presetNameInput = nameInput;
    state.editButton = editButton;
    container.append(header, grid, popupOverlay);

    function refreshPresetList(selectPresetId = null) {
        const allPresets = listPresets?.() || [];
        select.innerHTML = '';

        allPresets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            if (selectPresetId && preset.id === selectPresetId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    function applyPreset(preset) {
        state.activePreset = cloneDrumpadPreset(preset);
        for (let index = 0; index < state.activePreset.pads.length; index += 1) {
            syncPadVisual(index);
        }

        if (state.presetSelect) {
            state.presetSelect.value = state.activePreset.id || '';
        }

        if (state.presetNameInput) {
            state.presetNameInput.value = state.activePreset.name || '';
        }

        syncEditModeUi();
    }

    function getCurrentPreset() {
        return cloneDrumpadPreset(state.activePreset);
    }

    function syncPadVisual(index) {
        const pad = state.activePreset.pads[index];
        const ui = state.pads[index];
        if (!pad || !ui) {
            return;
        }

        ui.padData = pad;
        ui.button.dataset.padIndex = String(index + 1);
        ui.button.title = pad.sampleName || pad.name;
    }

    function getEditingPad() {
        if (state.editingPadIndex < 0) {
            return null;
        }

        return state.activePreset.pads[state.editingPadIndex] || null;
    }

    function openPadEditor(index) {
        const pad = state.activePreset.pads[index];
        if (!pad) {
            return;
        }

        state.editingPadIndex = index;
        popupTitle.textContent = `Pad ${index + 1}`;
        popupSourceSelect.value = pad.sourceMode === 'tone' ? 'tone' : 'sample';

        const gainPercent = Math.round(Math.min(1, Math.max(0, Number(pad.gain ?? 1))) * 100);
        popupGainInput.value = String(gainPercent);
        popupGainValue.textContent = `${gainPercent}%`;

        popupOverlay.classList.add('is-open');
    }

    function closePadEditor() {
        state.editingPadIndex = -1;
        popupOverlay.classList.remove('is-open');
    }

    async function triggerPad(index) {
        const pad = state.activePreset.pads[index];
        const ui = state.pads[index];
        if (!pad || !ui) {
            return;
        }

        try {
            await ensureAudioReady();

            if (!pad.sampleBuffer && pad.sampleId && sampleStore) {
                const blob = await sampleStore.getBlob(pad.sampleId);
                if (blob) {
                    pad.sampleBuffer = await audioEngine.decodeAudioData(await blob.arrayBuffer());
                }
            }

            if (!pad.sampleBuffer && pad.sampleDataUrl) {
                pad.sampleBuffer = await dataUrlToAudioBuffer(pad.sampleDataUrl, audioEngine);
            }

            const padGain = Math.min(1, Math.max(0, Number(pad.gain ?? 1)));
            const useSample = pad.sourceMode !== 'tone' && Boolean(pad.sampleBuffer);

            if (useSample) {
                audioEngine.playBuffer(pad.sampleBuffer, { volume: Math.max(0.0001, padGain) });
                onTrigger?.({
                    source: 'drumpad',
                    padIndex: index,
                    label: pad.name,
                    kind: 'sample',
                    duration: Math.max(0.05, pad.sampleBuffer.duration),
                    velocity: padGain
                });
            } else {
                const waveType = pad.waveType || 'triangle';
                const fallbackFreq = pad.fallbackFreq || 220;
                audioEngine.playTone(fallbackFreq, waveType, 0.24);
                onTrigger?.({
                    source: 'drumpad',
                    padIndex: index,
                    label: pad.name,
                    kind: 'tone',
                    frequency: fallbackFreq,
                    waveType,
                    duration: 0.24,
                    velocity: padGain
                });
            }

            ui.button.classList.add('is-active');
            window.setTimeout(() => ui.button.classList.remove('is-active'), 120);
        } catch (error) {
            onStatusChange?.(`Drumpad hiba: ${error.message}`, true);
        }
    }

    function syncEditModeUi() {
        container.classList.toggle('is-edit-mode', state.editMode);
        state.editButton?.classList.toggle('is-active', state.editMode);
        state.editButton?.setAttribute('aria-pressed', state.editMode ? 'true' : 'false');

        if (!state.editMode) {
            closePadEditor();
        }
    }

    function onKeyDown(event) {
        if (event.repeat) {
            return;
        }

        const key = event.key.toLowerCase();
        const index = state.activePreset.pads.findIndex((pad, idx) => {
            const expected = (pad.key || PAD_KEYS[idx]).toLowerCase();
            return expected === key;
        });

        if (index >= 0) {
            triggerPad(index);
        }
    }

    window.addEventListener('keydown', onKeyDown);

    refreshPresetList();
    applyPreset(state.activePreset);
    syncEditModeUi();

    return {
        applyPreset,
        getCurrentPreset,
        refreshPresetList
    };
}
