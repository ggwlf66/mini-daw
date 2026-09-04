let recordingCount = 1;

export class Recorder {
    constructor({ audioEngine, playlist }) {
        this.audioEngine = audioEngine;
        this.playlist = playlist;
        this.isRecording = false;
        this.recordStartTime = 0;
        this.events = [];
    }

    start() {
        if (!this.audioEngine || !this.playlist || this.isRecording) {
            return false;
        }

        this.isRecording = true;
        this.recordStartTime = this.audioEngine.getCurrentTime();
        this.events = [];
        return true;
    }

    captureEvent(eventData) {
        if (!this.isRecording || !eventData) {
            return;
        }

        const now = this.audioEngine.getCurrentTime();
        const startTime = Math.max(0, now - this.recordStartTime);
        const duration = Math.max(0.05, Number(eventData.duration) || 0.25);

        this.events.push({
            id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            source: eventData.source || 'unknown',
            label: eventData.label || eventData.note || 'event',
            kind: eventData.kind || 'tone',
            padIndex: typeof eventData.padIndex === 'number' ? eventData.padIndex : null,
            note: eventData.note || null,
            frequency: eventData.frequency ?? null,
            waveType: eventData.waveType || 'sine',
            buffer: eventData.buffer || null,
            startTime,
            duration,
            velocity: eventData.velocity ?? 1
        });
    }

    stop() {
        if (!this.isRecording) {
            return null;
        }

        this.isRecording = false;

        if (this.events.length === 0) {
            this.events = [];
            return null;
        }

        const clipDuration = this.events.reduce((maxDuration, eventItem) => {
            return Math.max(maxDuration, eventItem.startTime + eventItem.duration);
        }, 0);

        const clip = {
            id: `clip-rec-${Date.now()}`,
            name: `Take ${recordingCount++}`,
            startTime: this.playlist.getPlayheadTime(),
            duration: Math.max(0.2, clipDuration),
            color: this.randomColor(),
            events: [...this.events]
        };

        this.playlist.addClipToActiveTrack(clip);
        this.events = [];
        return clip;
    }

    randomColor() {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue} 72% 52%)`;
    }
}
