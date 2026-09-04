const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_TIME = 0.1;
const DEFAULT_BPM = 120;
const BEATS_PER_BAR = 4;

export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.bpm = DEFAULT_BPM;
        this.isRunning = false;
        this.current16thNote = 0;
        this.nextNoteTime = 0;
        this.schedulerId = null;
        this.hasUnlockedAudio = false;
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

        if (this.audioContext.state !== 'running') {
            throw new Error('Az AudioContext nem kerult aktiv allapotba.');
        }

        if (!this.hasUnlockedAudio) {
            this.unlockAudio();
        }

        return this.audioContext;
    }

    unlockAudio() {
        if (!this.audioContext || !this.masterGain || this.hasUnlockedAudio) {
            return;
        }

        const now = this.audioContext.currentTime;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);

        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        oscillator.start(now);
        oscillator.stop(now + 0.03);

        this.hasUnlockedAudio = true;
    }

    setBpm(bpm) {
        this.bpm = Math.min(240, Math.max(40, Number(bpm) || DEFAULT_BPM));
    }

    isMetronomeRunning() {
        return this.isRunning;
    }

    getState() {
        return this.audioContext ? this.audioContext.state : 'inactive';
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

        const startTime = this.audioContext.currentTime;
        const endTime = startTime + duration;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startTime);

        gainNode.gain.setValueAtTime(0.0001, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.18, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        oscillator.start(startTime);
        oscillator.stop(endTime + 0.02);
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
