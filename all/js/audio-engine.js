const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_TIME = 0.1;
const DEFAULT_BPM = 120;
const BEATS_PER_BAR = 4;
const EXPORT_TAIL_SECONDS = 0.25;
const NOTE_FREQUENCIES = {
    C4: 261.63,
    'C#4': 277.18,
    D4: 293.66,
    'D#4': 311.13,
    E4: 329.63,
    F4: 349.23,
    'F#4': 369.99,
    G4: 392,
    'G#4': 415.3,
    A4: 440,
    'A#4': 466.16,
    B4: 493.88,
    C5: 523.25
};

export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.trackGainNodes = new Map();
        this.bpm = DEFAULT_BPM;
        this.isRunning = false;
        this.current16thNote = 0;
        this.nextNoteTime = 0;
        this.schedulerId = null;
        this.activeSources = new Set();
    }

    async init() {
        if (!this.audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;

            if (!AudioContextClass) {
                throw new Error('A Web Audio API ebben a bongeszoben nem erheto el.');
            }

            this.audioContext = new AudioContextClass();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.85;
            this.masterGain.connect(this.audioContext.destination);
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        return this.audioContext;
    }

    setBpm(bpm) {
        this.bpm = Math.min(240, Math.max(40, Number(bpm) || DEFAULT_BPM));
    }

    getCurrentTime() {
        return this.audioContext ? this.audioContext.currentTime : 0;
    }

    getState() {
        return this.audioContext ? this.audioContext.state : 'inactive';
    }

    isMetronomeRunning() {
        return this.isRunning;
    }

    startMetronome() {
        if (!this.audioContext || this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.current16thNote = 0;
        this.nextNoteTime = this.audioContext.currentTime + 0.05;
        this.scheduler();
    }

    stopMetronome() {
        this.isRunning = false;

        if (this.schedulerId) {
            window.clearTimeout(this.schedulerId);
            this.schedulerId = null;
        }
    }

    playTone(frequency, type = 'sine', duration = 0.25) {
        if (!this.audioContext || !this.masterGain) {
            throw new Error('A hangmotor nincs inicializalva.');
        }

        this.scheduleTone(frequency, type, duration, this.audioContext.currentTime, 1, this.masterGain);
    }

    scheduleTone(frequency, type = 'sine', duration = 0.25, startTime = 0, velocity = 1, outputNode = null) {
        if (!this.audioContext || !this.masterGain) {
            throw new Error('A hangmotor nincs inicializalva.');
        }

        const safeStartTime = Math.max(this.audioContext.currentTime, startTime);
        const safeDuration = Math.max(0.05, duration || 0.25);
        const endTime = safeStartTime + safeDuration;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, safeStartTime);

        gainNode.gain.setValueAtTime(0.0001, safeStartTime);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocity) * 0.18, safeStartTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

        oscillator.connect(gainNode);
        gainNode.connect(outputNode || this.masterGain);

        this.trackSource(oscillator);
        oscillator.start(safeStartTime);
        oscillator.stop(endTime + 0.02);
    }

    async decodeAudioData(arrayBuffer) {
        if (!this.audioContext) {
            throw new Error('A hangmotor nincs inicializalva.');
        }

        return this.audioContext.decodeAudioData(arrayBuffer.slice(0));
    }

    playBuffer(audioBuffer, options = {}) {
        if (!this.audioContext || !this.masterGain) {
            throw new Error('A hangmotor nincs inicializalva.');
        }

        const { volume = 0.95, playbackRate = 1 } = options;
        this.scheduleBuffer(audioBuffer, this.audioContext.currentTime, { volume, playbackRate }, this.masterGain);
    }

    scheduleBuffer(audioBuffer, startTime = 0, options = {}, outputNode = null) {
        if (!this.audioContext || !this.masterGain || !audioBuffer) {
            throw new Error('A hangmotor nincs inicializalva vagy hianyzik a minta.');
        }

        const { volume = 0.95, playbackRate = 1 } = options;
        const safeStartTime = Math.max(this.audioContext.currentTime, startTime);
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();

        source.buffer = audioBuffer;
        source.playbackRate.setValueAtTime(playbackRate, safeStartTime);
        gainNode.gain.setValueAtTime(Math.max(0.0001, volume), safeStartTime);

        source.connect(gainNode);
        gainNode.connect(outputNode || this.masterGain);

        this.trackSource(source);
        source.start(safeStartTime);
    }

    playPlaylist(tracks, currentTime = 0) {
        if (!this.audioContext || !Array.isArray(tracks)) {
            return;
        }

        this.stopScheduledPlayback();
        this.trackGainNodes.clear();

        const activeTracks = this.getAudibleTracks(tracks);
        const offset = Math.max(0, Number(currentTime) || 0);
        const timelineStart = this.audioContext.currentTime + 0.03;

        activeTracks.forEach((track) => {
            const trackVolume = Math.min(1, Math.max(0, track.volume ?? 1));
            const trackGain = this.audioContext.createGain();
            trackGain.gain.setValueAtTime(trackVolume, this.audioContext.currentTime);
            trackGain.connect(this.masterGain);
            this.trackGainNodes.set(track.id, trackGain);

            (track.clips || []).forEach((clip) => {
                (clip.events || []).forEach((eventItem) => {
                    const eventTimelineTime = (clip.startTime || 0) + (eventItem.startTime || 0);
                    const relative = eventTimelineTime - offset;

                    if (relative < 0) {
                        return;
                    }

                    const when = timelineStart + relative;
                    const playbackEvent = this.resolvePlaybackEvent(track, eventItem);

                    if (playbackEvent.kind === 'sample' && playbackEvent.buffer) {
                        this.scheduleBuffer(playbackEvent.buffer, when, {
                            playbackRate: playbackEvent.playbackRate || 1,
                            volume: playbackEvent.velocity || 1
                        }, trackGain);
                        return;
                    }

                    this.scheduleTone(
                        playbackEvent.frequency || 440,
                        playbackEvent.waveType || 'sine',
                        playbackEvent.duration || 0.25,
                        when,
                        playbackEvent.velocity || 1,
                        trackGain
                    );
                });
            });
        });
    }

    setTrackVolume(trackId, volume) {
        if (!trackId) {
            return;
        }

        const gainNode = this.trackGainNodes.get(trackId);
        if (!gainNode || !this.audioContext) {
            return;
        }

        const safeVolume = Math.min(1, Math.max(0, Number(volume) || 0));
        gainNode.gain.setTargetAtTime(safeVolume, this.audioContext.currentTime, 0.01);
    }

    resolvePlaybackEvent(track, eventItem) {
        const velocity = eventItem.velocity || 1;
        const duration = eventItem.duration || 0.25;

        if (eventItem.source === 'drumpad') {
            const pad = track?.preset?.drumpad?.pads?.[eventItem.padIndex];
            if (pad?.sampleBuffer) {
                return {
                    kind: 'sample',
                    buffer: pad.sampleBuffer,
                    velocity,
                    duration: Math.max(duration, pad.sampleBuffer.duration || duration)
                };
            }

            return {
                kind: 'tone',
                frequency: pad?.fallbackFreq || eventItem.frequency || 220,
                waveType: pad?.waveType || eventItem.waveType || 'triangle',
                duration,
                velocity
            };
        }

        if (eventItem.source === 'piano') {
            const synth = track?.preset?.synth || {};

            if (synth.sampleBuffer) {
                const noteFreq = NOTE_FREQUENCIES[eventItem.note] || eventItem.frequency || 440;
                const rootFreq = synth.rootFreq || 261.63;
                return {
                    kind: 'sample',
                    buffer: synth.sampleBuffer,
                    playbackRate: noteFreq / rootFreq,
                    duration,
                    velocity
                };
            }

            return {
                kind: 'tone',
                frequency: NOTE_FREQUENCIES[eventItem.note] || eventItem.frequency || 440,
                waveType: synth.waveform || eventItem.waveType || 'sine',
                duration: Math.max(0.05, synth.release || duration),
                velocity
            };
        }

        return {
            kind: eventItem.kind || 'tone',
            buffer: eventItem.buffer || null,
            frequency: eventItem.frequency || 440,
            waveType: eventItem.waveType || 'sine',
            duration,
            velocity
        };
    }

    stopScheduledPlayback() {
        this.activeSources.forEach((source) => {
            try {
                source.stop();
            } catch (_error) {
                // no-op: source might already be stopped.
            }
        });

        this.activeSources.clear();
        this.trackGainNodes.forEach((gainNode) => {
            try {
                gainNode.disconnect();
            } catch (_error) {
                // no-op
            }
        });
        this.trackGainNodes.clear();
    }

    getAudibleTracks(tracks) {
        const soloTracks = tracks.filter((track) => track.solo && !track.muted);
        if (soloTracks.length > 0) {
            return soloTracks;
        }

        return tracks.filter((track) => !track.muted);
    }

    getSongDuration(tracks) {
        return tracks.reduce((songMax, track) => {
            const trackMax = (track.clips || []).reduce((clipMax, clip) => {
                return Math.max(clipMax, (clip.startTime || 0) + (clip.duration || 0));
            }, 0);

            return Math.max(songMax, trackMax);
        }, 0);
    }

    async exportToWav(tracks, bpm = DEFAULT_BPM) {
        if (!Array.isArray(tracks)) {
            throw new Error('Export: ervenytelen tracks lista.');
        }

        const _safeBpm = Math.min(240, Math.max(40, Number(bpm) || DEFAULT_BPM));
        const sampleRate = this.audioContext?.sampleRate || 44100;
        const activeTracks = this.getAudibleTracks(tracks);
        const songDuration = Math.max(1, this.getSongDuration(activeTracks) + EXPORT_TAIL_SECONDS);
        const frameLength = Math.ceil(songDuration * sampleRate);

        const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineContextClass) {
            throw new Error('OfflineAudioContext nem erheto el ebben a kornyezetben.');
        }

        const offlineContext = new OfflineContextClass(2, frameLength, sampleRate);

        activeTracks.forEach((track) => {
            const trackGain = offlineContext.createGain();
            trackGain.gain.value = Math.min(1, Math.max(0, track.volume ?? 1));
            trackGain.connect(offlineContext.destination);

            (track.clips || []).forEach((clip) => {
                (clip.events || []).forEach((eventItem) => {
                    const when = Math.max(0, (clip.startTime || 0) + (eventItem.startTime || 0));

                    const playbackEvent = this.resolvePlaybackEvent(track, eventItem);

                    if (playbackEvent.kind === 'sample' && playbackEvent.buffer) {
                        const source = offlineContext.createBufferSource();
                        const gainNode = offlineContext.createGain();

                        source.buffer = playbackEvent.buffer;
                        source.playbackRate.setValueAtTime(playbackEvent.playbackRate || 1, when);
                        gainNode.gain.value = Math.max(0.0001, playbackEvent.velocity || 1);

                        source.connect(gainNode);
                        gainNode.connect(trackGain);
                        source.start(when);
                        return;
                    }

                    const osc = offlineContext.createOscillator();
                    const toneGain = offlineContext.createGain();
                    const duration = Math.max(0.05, playbackEvent.duration || 0.25);
                    const endTime = when + duration;

                    osc.type = playbackEvent.waveType || 'sine';
                    osc.frequency.setValueAtTime(playbackEvent.frequency || 440, when);

                    toneGain.gain.setValueAtTime(0.0001, when);
                    toneGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, playbackEvent.velocity || 1) * 0.18, when + 0.01);
                    toneGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

                    osc.connect(toneGain);
                    toneGain.connect(trackGain);
                    osc.start(when);
                    osc.stop(endTime + 0.02);
                });
            });
        });

        const renderedBuffer = await offlineContext.startRendering();
        const wavArrayBuffer = this.audioBufferToWav(renderedBuffer);
        return new Blob([wavArrayBuffer], { type: 'audio/wav' });
    }

    audioBufferToWav(audioBuffer) {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const bitDepth = 16;
        const blockAlign = numberOfChannels * (bitDepth / 8);
        const byteRate = sampleRate * blockAlign;
        const dataSize = audioBuffer.length * blockAlign;

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        this.writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeAscii(view, 8, 'WAVE');
        this.writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        this.writeAscii(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        const channels = [];
        for (let channel = 0; channel < numberOfChannels; channel += 1) {
            channels.push(audioBuffer.getChannelData(channel));
        }

        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i += 1) {
            for (let channel = 0; channel < numberOfChannels; channel += 1) {
                const sample = Math.max(-1, Math.min(1, channels[channel][i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return buffer;
    }

    writeAscii(view, offset, text) {
        for (let i = 0; i < text.length; i += 1) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    trackSource(source) {
        this.activeSources.add(source);
        source.onended = () => {
            this.activeSources.delete(source);
        };
    }

    scheduler() {
        if (!this.audioContext || !this.isRunning) {
            return;
        }

        while (this.nextNoteTime < this.audioContext.currentTime + SCHEDULE_AHEAD_TIME) {
            this.scheduleMetronomeClick(this.current16thNote, this.nextNoteTime);
            this.advanceNote();
        }

        this.schedulerId = window.setTimeout(() => this.scheduler(), LOOKAHEAD_MS);
    }

    advanceNote() {
        const secondsPerBeat = 60 / this.bpm;
        this.nextNoteTime += 0.25 * secondsPerBeat;
        this.current16thNote += 1;

        if (this.current16thNote >= BEATS_PER_BAR * 4) {
            this.current16thNote = 0;
        }
    }

    scheduleMetronomeClick(noteIndex, time) {
        const isQuarterNote = noteIndex % 4 === 0;

        if (!isQuarterNote) {
            return;
        }

        const isDownbeat = noteIndex === 0;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(isDownbeat ? 1320 : 880, time);

        gainNode.gain.setValueAtTime(0.0001, time);
        gainNode.gain.exponentialRampToValueAtTime(0.22, time + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        oscillator.start(time);
        oscillator.stop(time + 0.06);
    }
}
