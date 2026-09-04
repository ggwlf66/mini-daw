import { createTrack } from '../state.js';

const PX_PER_SECOND = 72;
const MIN_TIMELINE_SECONDS = 16;
const RULER_STEP_SECONDS = 1;
const BEATS_PER_BAR = 4;
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 6;

export class PlaylistUI {
    constructor({
        container,
        onStateChange,
        onActiveTrackChange,
        initialTracks = [],
        initialActiveTrackId = null,
        initialPlayheadTime = 0
    }) {
        this.container = container;
        this.onStateChange = onStateChange;
        this.onActiveTrackChange = onActiveTrackChange;
        this.tracks = initialTracks.length > 0 ? initialTracks : [this.createTrack('Track 1', 'drumpad')];
        this.activeTrackId = this.tracks.some((track) => track.id === initialActiveTrackId)
            ? initialActiveTrackId
            : this.tracks[0].id;
        this.playheadTime = Math.max(0, Number(initialPlayheadTime) || 0);
        this.selectedClipRef = null;
        this.dragState = null;
        this.scrollOffsetPx = 0;
        this.scrollbarPointerId = null;
        this.rulerPointerId = null;
        this.clipPointerState = null;
        this.longPressTimerId = 0;
        this.contextMenuEl = null;
        this.contextMenuClipRef = null;

        this.scrollbarStripEl = null;
        this.scrollbarThumbEl = null;
        this.rulerStripEl = null;
        this.rulerContentEl = null;
        this.tracksEl = null;
        this.tracksContentEl = null;
        this.playheadEl = null;

        this.onDocumentPointerDown = (event) => {
            if (!this.contextMenuEl) {
                return;
            }

            if (this.contextMenuEl.contains(event.target)) {
                return;
            }

            this.closeClipContextMenu();
        };

        document.addEventListener('pointerdown', this.onDocumentPointerDown);

        this.render();
    }

    createTrack(name, type) {
        return createTrack(name, type);
    }

    render() {
        if (!this.container) {
            return;
        }

        this.container.innerHTML = '';
        this.container.classList.add('playlist-shell');

        const scrollbarStrip = document.createElement('div');
        scrollbarStrip.id = 'playlist-scrollbar-strip';
        scrollbarStrip.className = 'playlist-scrollbar-strip';

        const scrollbarThumb = document.createElement('div');
        scrollbarThumb.className = 'playlist-scrollbar-thumb';
        scrollbarStrip.appendChild(scrollbarThumb);
        scrollbarStrip.addEventListener('pointerdown', (event) => this.onScrollbarPointerDown(event));
        scrollbarStrip.addEventListener('pointermove', (event) => this.onScrollbarPointerMove(event));
        scrollbarStrip.addEventListener('pointerup', (event) => this.onScrollbarPointerEnd(event));
        scrollbarStrip.addEventListener('pointercancel', (event) => this.onScrollbarPointerEnd(event));

        const rulerStrip = document.createElement('div');
        rulerStrip.id = 'playlist-ruler-strip';
        rulerStrip.className = 'playlist-ruler-strip';

        const rulerContent = document.createElement('div');
        rulerContent.className = 'playlist-ruler-content';
        rulerStrip.appendChild(rulerContent);

        rulerStrip.addEventListener('pointerdown', (event) => this.onRulerPointerDown(event));
        rulerStrip.addEventListener('pointermove', (event) => this.onRulerPointerMove(event));
        rulerStrip.addEventListener('pointerup', (event) => this.onRulerPointerEnd(event));
        rulerStrip.addEventListener('pointercancel', (event) => this.onRulerPointerEnd(event));

        const tracks = document.createElement('div');
        tracks.id = 'playlist-tracks';
        tracks.className = 'playlist-tracks';

        const tracksContent = document.createElement('div');
        tracksContent.className = 'playlist-tracks-content';
        tracks.appendChild(tracksContent);

        tracks.addEventListener('pointerdown', (event) => {
            if (event.target.closest('.clip')) {
                return;
            }

            const rect = tracks.getBoundingClientRect();
            const x = event.clientX - rect.left + this.scrollOffsetPx;
            this.setPlayheadTime(this.pxToTime(x));
        });

        tracks.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });

        const playhead = document.createElement('div');
        playhead.className = 'playhead';

        this.scrollbarStripEl = scrollbarStrip;
        this.scrollbarThumbEl = scrollbarThumb;
        this.rulerStripEl = rulerStrip;
        this.rulerContentEl = rulerContent;
        this.tracksEl = tracks;
        this.tracksContentEl = tracksContent;
        this.playheadEl = playhead;

        this.container.append(scrollbarStrip, rulerStrip, tracks);

        this.renderTimeline();
    }

    getTracks() {
        return this.tracks;
    }

    getPlayheadTime() {
        return this.playheadTime;
    }

    setPlayheadTime(seconds) {
        this.playheadTime = Math.max(0, Number(seconds) || 0);
        this.updatePlayheadVisual();
        this.notifyStateChange();
    }

    getProjectDuration() {
        return this.tracks.reduce((projectMax, track) => {
            const trackMax = track.clips.reduce((clipMax, clip) => {
                return Math.max(clipMax, clip.startTime + clip.duration);
            }, 0);

            return Math.max(projectMax, trackMax);
        }, 0);
    }

    addTrack(type = 'drumpad') {
        const nextIndex = this.tracks.length + 1;
        const track = this.createTrack(`Track ${nextIndex}`, type);
        this.tracks.push(track);
        this.activeTrackId = track.id;
        this.renderTimeline();
        this.notifyStateChange();
    }

    removeActiveTrack() {
        if (this.tracks.length <= 1) {
            return;
        }

        const removeIndex = this.tracks.findIndex((track) => track.id === this.activeTrackId);
        if (removeIndex < 0) {
            return;
        }

        this.tracks.splice(removeIndex, 1);
        const fallbackTrack = this.tracks[Math.max(0, removeIndex - 1)];
        this.activeTrackId = fallbackTrack.id;

        if (this.selectedClipRef && this.selectedClipRef.trackId === this.activeTrackId) {
            this.selectedClipRef = null;
        }

        this.renderTimeline();
        this.notifyStateChange();
    }

    selectTrack(trackId) {
        this.activeTrackId = trackId;
        this.renderTimeline();
        this.notifyStateChange();
    }

    addClipToActiveTrack(clip) {
        const track = this.tracks.find((entry) => entry.id === this.activeTrackId);
        if (!track) {
            return;
        }

        track.clips.push({
            ...clip,
            events: Array.isArray(clip.events) ? clip.events : []
        });

        this.selectedClipRef = { trackId: track.id, clipId: clip.id };
        this.renderTimeline();
        this.notifyStateChange();
    }

    setProjectData({ tracks = [], activeTrackId = null, playheadTime = 0 } = {}) {
        const safeTracks = Array.isArray(tracks) && tracks.length > 0 ? tracks : [this.createTrack('Track 1', 'drumpad')];
        this.tracks = safeTracks;

        const hasActive = safeTracks.some((track) => track.id === activeTrackId);
        this.activeTrackId = hasActive ? activeTrackId : safeTracks[0].id;
        this.playheadTime = Math.max(0, Number(playheadTime) || 0);
        this.selectedClipRef = null;
        this.scrollOffsetPx = 0;

        this.renderTimeline();
        this.notifyStateChange();
    }

    updateTrackMixer(trackId, patch) {
        const track = this.tracks.find((entry) => entry.id === trackId);
        if (!track || !patch) {
            return;
        }

        if (typeof patch.volume === 'number') {
            track.volume = Math.min(1, Math.max(0, patch.volume));
        }

        if (typeof patch.muted === 'boolean') {
            track.muted = patch.muted;
        }

        if (typeof patch.solo === 'boolean') {
            track.solo = patch.solo;
        }

        this.notifyStateChange();
    }

    splitSelectedClip() {
        if (!this.selectedClipRef) {
            return;
        }

        const track = this.tracks.find((entry) => entry.id === this.selectedClipRef.trackId);
        if (!track) {
            return;
        }

        const clipIndex = track.clips.findIndex((clip) => clip.id === this.selectedClipRef.clipId);
        if (clipIndex < 0) {
            return;
        }

        const clip = track.clips[clipIndex];
        const splitAt = this.playheadTime;
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

        if (splitAt <= clipStart + 0.02 || splitAt >= clipEnd - 0.02) {
            return;
        }

        const leftDuration = splitAt - clipStart;
        const rightDuration = clipEnd - splitAt;

        const leftEvents = [];
        const rightEvents = [];

        clip.events.forEach((eventItem) => {
            const eventStartAbs = clipStart + eventItem.startTime;
            const eventEndAbs = eventStartAbs + eventItem.duration;

            if (eventEndAbs <= splitAt) {
                leftEvents.push({ ...eventItem });
                return;
            }

            if (eventStartAbs >= splitAt) {
                rightEvents.push({ ...eventItem, startTime: eventStartAbs - splitAt });
                return;
            }

            const leftPartDuration = Math.max(0.01, splitAt - eventStartAbs);
            const rightPartDuration = Math.max(0.01, eventEndAbs - splitAt);

            leftEvents.push({ ...eventItem, duration: leftPartDuration });
            rightEvents.push({ ...eventItem, startTime: 0, duration: rightPartDuration });
        });

        const leftClip = {
            ...clip,
            id: `${clip.id}-a`,
            name: `${clip.name} A`,
            duration: leftDuration,
            events: leftEvents
        };

        const rightClip = {
            ...clip,
            id: `${clip.id}-b`,
            name: `${clip.name} B`,
            startTime: splitAt,
            duration: rightDuration,
            events: rightEvents
        };

        track.clips.splice(clipIndex, 1, leftClip, rightClip);
        this.selectedClipRef = { trackId: track.id, clipId: rightClip.id };
        this.renderTimeline();
        this.notifyStateChange();
    }

    renderTimeline() {
        if (!this.tracksEl || !this.tracksContentEl || !this.rulerContentEl) {
            return;
        }

        this.tracksContentEl.innerHTML = '';
        this.tracksContentEl.appendChild(this.playheadEl);
        this.rulerContentEl.innerHTML = '';

        const duration = Math.max(MIN_TIMELINE_SECONDS, this.getProjectDuration() + 4);
        const timelineWidthPx = this.timeToPx(duration);
        this.tracksContentEl.style.width = `${timelineWidthPx}px`;
        this.rulerContentEl.style.width = `${timelineWidthPx}px`;

        this.renderRuler(duration);

        this.tracks.forEach((track) => {
            const row = document.createElement('div');
            row.className = `timeline-track-row ${track.id === this.activeTrackId ? 'is-active' : ''}`;
            row.dataset.trackId = track.id;

            row.addEventListener('pointerdown', () => {
                this.activeTrackId = track.id;
                this.notifyStateChange();
                this.renderTimeline();
            });

            track.clips.forEach((clip) => {
                const clipEl = document.createElement('button');
                clipEl.type = 'button';
                const isSelected = this.selectedClipRef
                    && this.selectedClipRef.trackId === track.id
                    && this.selectedClipRef.clipId === clip.id;

                clipEl.className = `clip ${isSelected ? 'is-selected' : ''}`;
                clipEl.style.left = `${this.timeToPx(clip.startTime)}px`;
                clipEl.style.width = `${Math.max(this.timeToPx(clip.duration), 40)}px`;
                clipEl.style.background = clip.color || 'hsl(193 68% 52%)';
                clipEl.textContent = clip.name;
                clipEl.title = `${clip.name} | ${clip.startTime.toFixed(2)}s`;

                clipEl.addEventListener('click', () => {
                    this.selectedClipRef = { trackId: track.id, clipId: clip.id };
                    this.renderTimeline();
                });

                clipEl.addEventListener('pointerdown', (event) => this.onClipPointerDown(event, track.id, clip.id, clipEl));
                clipEl.addEventListener('pointermove', (event) => this.onClipPointerMove(event, track.id, clip.id, clipEl));
                clipEl.addEventListener('pointerup', (event) => this.onClipPointerEnd(event, track.id, clip.id, clipEl));
                clipEl.addEventListener('pointercancel', (event) => this.onClipPointerEnd(event, track.id, clip.id, clipEl));
                clipEl.addEventListener('contextmenu', (event) => {
                    event.preventDefault();
                });

                row.appendChild(clipEl);
            });

            this.tracksContentEl.appendChild(row);
        });

        this.syncHorizontalViewport();
        this.updateScrollbarThumb();
        this.updatePlayheadVisual();
    }

    renderRuler(durationSeconds) {
        const totalSteps = Math.ceil(durationSeconds / RULER_STEP_SECONDS);

        for (let step = 0; step <= totalSteps; step += 1) {
            const second = step * RULER_STEP_SECONDS;
            const x = this.timeToPx(second);

            const tick = document.createElement('div');
            tick.className = 'ruler-tick';
            tick.style.left = `${x}px`;

            if (second % BEATS_PER_BAR === 0) {
                const barNumber = Math.floor(second / BEATS_PER_BAR) + 1;
                tick.classList.add('bar');

                const label = document.createElement('span');
                label.className = 'ruler-label';
                label.textContent = String(barNumber);
                tick.appendChild(label);
            }

            this.rulerContentEl.appendChild(tick);
        }
    }

    onScrollbarPointerDown(event) {
        if (!event.isPrimary || event.button > 0) {
            return;
        }

        event.preventDefault();
        this.scrollbarPointerId = event.pointerId;
        this.scrollbarStripEl?.setPointerCapture(event.pointerId);
        this.updateScrollFromClientX(event.clientX);
    }

    onScrollbarPointerMove(event) {
        if (this.scrollbarPointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        this.updateScrollFromClientX(event.clientX);
    }

    onScrollbarPointerEnd(event) {
        if (this.scrollbarPointerId !== event.pointerId) {
            return;
        }

        this.scrollbarStripEl?.releasePointerCapture(event.pointerId);
        this.scrollbarPointerId = null;
    }

    updateScrollFromClientX(clientX) {
        if (!this.scrollbarStripEl || !this.tracksContentEl || !this.tracksEl) {
            return;
        }

        const rect = this.scrollbarStripEl.getBoundingClientRect();
        const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const totalBarWidth = rect.width;
        const totalPlaylistWidth = this.tracksContentEl.offsetWidth || 0;
        const viewportWidth = this.tracksEl.clientWidth || 0;
        const maxScroll = Math.max(0, totalPlaylistWidth - viewportWidth);
        const ratio = totalBarWidth > 0 ? relativeX / totalBarWidth : 0;

        // Keep finger/stylus point mapped directly to full timeline ratio.
        this.scrollOffsetPx = ratio * maxScroll;
        this.syncHorizontalViewport();
        this.updateScrollbarThumb();
    }

    onRulerPointerDown(event) {
        if (!event.isPrimary || event.button > 0) {
            return;
        }

        event.preventDefault();
        this.rulerPointerId = event.pointerId;
        this.rulerStripEl?.setPointerCapture(event.pointerId);
        this.scrubPlayheadFromClientX(event.clientX);
    }

    onRulerPointerMove(event) {
        if (this.rulerPointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        this.scrubPlayheadFromClientX(event.clientX);
    }

    onRulerPointerEnd(event) {
        if (this.rulerPointerId !== event.pointerId) {
            return;
        }

        this.rulerStripEl?.releasePointerCapture(event.pointerId);
        this.rulerPointerId = null;
    }

    scrubPlayheadFromClientX(clientX) {
        if (!this.rulerStripEl) {
            return;
        }

        const rect = this.rulerStripEl.getBoundingClientRect();
        const x = Math.max(0, clientX - rect.left);
        const time = this.pxToTime(x + this.scrollOffsetPx);
        this.setPlayheadTime(time);
    }

    syncHorizontalViewport() {
        if (!this.tracksContentEl || !this.rulerContentEl || !this.tracksEl) {
            return;
        }

        const maxOffset = this.getMaxScrollOffsetPx();
        this.scrollOffsetPx = Math.max(0, Math.min(maxOffset, this.scrollOffsetPx));
        this.tracksEl.scrollLeft = this.scrollOffsetPx;
        this.rulerContentEl.style.transform = `translateX(${-this.scrollOffsetPx}px)`;
    }

    updateScrollbarThumb() {
        if (!this.scrollbarStripEl || !this.scrollbarThumbEl || !this.tracksEl || !this.tracksContentEl) {
            return;
        }

        const stripWidth = this.scrollbarStripEl.clientWidth;
        const viewportWidth = this.tracksEl.clientWidth || stripWidth;
        const timelineWidth = this.tracksContentEl.offsetWidth || viewportWidth;
        const maxOffset = Math.max(0, timelineWidth - viewportWidth);

        const visibleRatio = timelineWidth > 0 ? Math.min(1, viewportWidth / timelineWidth) : 1;
        const thumbWidth = Math.max(28, stripWidth * visibleRatio);
        const travel = Math.max(0, stripWidth - thumbWidth);
        const offsetRatio = maxOffset > 0 ? this.scrollOffsetPx / maxOffset : 0;
        const thumbLeft = travel * offsetRatio;

        this.scrollbarThumbEl.style.width = `${thumbWidth}px`;
        this.scrollbarThumbEl.style.left = `${thumbLeft}px`;
    }

    getMaxScrollOffsetPx() {
        const viewportWidth = this.tracksEl?.clientWidth || 0;
        const timelineWidth = this.tracksContentEl?.offsetWidth || viewportWidth;
        return Math.max(0, timelineWidth - viewportWidth);
    }

    beginClipDrag(event, trackId, clipId) {
        const track = this.tracks.find((entry) => entry.id === trackId);
        const clip = track?.clips.find((entry) => entry.id === clipId);
        if (!clip || !this.tracksEl) {
            return;
        }

        this.selectedClipRef = { trackId, clipId };
        const startX = event.clientX;
        const initialStart = clip.startTime;

        this.dragState = {
            track,
            clip,
            startX,
            initialStart
        };

        const onMove = (moveEvent) => {
            if (!this.dragState) {
                return;
            }

            const deltaPx = moveEvent.clientX - this.dragState.startX;
            const deltaSec = this.pxToTime(deltaPx);
            this.dragState.clip.startTime = Math.max(0, this.dragState.initialStart + deltaSec);
            this.renderTimeline();
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            this.dragState = null;
            this.notifyStateChange();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    onClipPointerDown(event, trackId, clipId, clipEl) {
        if (!event.isPrimary || event.button > 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const track = this.tracks.find((entry) => entry.id === trackId);
        const clip = track?.clips.find((entry) => entry.id === clipId);
        if (!track || !clip) {
            return;
        }

        this.closeClipContextMenu();
        this.clearLongPressTimer();

        this.selectedClipRef = { trackId, clipId };
        this.activeTrackId = trackId;

        this.clipPointerState = {
            pointerId: event.pointerId,
            trackId,
            clipId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
            initialStartTime: clip.startTime,
            moved: false,
            dragging: false,
            longPressOpened: false
        };

        clipEl.setPointerCapture(event.pointerId);

        this.longPressTimerId = window.setTimeout(() => {
            if (!this.clipPointerState) {
                return;
            }

            if (this.clipPointerState.moved || this.clipPointerState.dragging) {
                return;
            }

            this.clipPointerState.longPressOpened = true;
            this.openClipContextMenu(trackId, clipId, clipEl, {
                clientX: this.clipPointerState.lastClientX,
                clientY: this.clipPointerState.lastClientY
            });
        }, LONG_PRESS_MS);
    }

    onClipPointerMove(event, trackId, clipId, clipEl) {
        if (!this.clipPointerState || this.clipPointerState.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const track = this.tracks.find((entry) => entry.id === trackId);
        const clip = track?.clips.find((entry) => entry.id === clipId);
        if (!track || !clip) {
            return;
        }

        const deltaPx = event.clientX - this.clipPointerState.startClientX;
        const deltaPy = event.clientY - this.clipPointerState.startClientY;
        const movement = Math.hypot(deltaPx, deltaPy);

        this.clipPointerState.lastClientX = event.clientX;
        this.clipPointerState.lastClientY = event.clientY;

        if (movement > DRAG_THRESHOLD_PX) {
            this.clipPointerState.moved = true;
            this.clearLongPressTimer();
        }

        if (!this.clipPointerState.moved || this.clipPointerState.longPressOpened) {
            return;
        }

        this.clipPointerState.dragging = true;
        const deltaSec = this.pxToTime(deltaPx);
        clip.startTime = Math.max(0, this.clipPointerState.initialStartTime + deltaSec);
        clipEl.style.left = `${this.timeToPx(clip.startTime)}px`;
        clipEl.classList.add('is-dragging');
    }

    onClipPointerEnd(event, trackId, clipId, clipEl) {
        if (!this.clipPointerState || this.clipPointerState.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.clearLongPressTimer();
        clipEl.releasePointerCapture(event.pointerId);

        const didDrag = this.clipPointerState.dragging;
        const openedContext = this.clipPointerState.longPressOpened;
        this.clipPointerState = null;
        clipEl.classList.remove('is-dragging');

        if (didDrag) {
            this.renderTimeline();
            this.notifyStateChange();
            return;
        }

        if (!openedContext) {
            this.selectedClipRef = { trackId, clipId };
            this.activeTrackId = trackId;
            this.renderTimeline();
            this.notifyStateChange();
        }
    }

    clearLongPressTimer() {
        if (!this.longPressTimerId) {
            return;
        }

        window.clearTimeout(this.longPressTimerId);
        this.longPressTimerId = 0;
    }

    openClipContextMenu(trackId, clipId, clipEl, pointerPosition = null) {
        this.closeClipContextMenu();

        if (!this.tracksEl) {
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'clip-context-menu';

        const duplicateButton = document.createElement('button');
        duplicateButton.type = 'button';
        duplicateButton.textContent = 'Duplicate';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';

        const moveButton = document.createElement('button');
        moveButton.type = 'button';
        moveButton.textContent = 'Move to new track';

        duplicateButton.addEventListener('click', () => {
            this.duplicateClip(trackId, clipId);
            this.closeClipContextMenu();
        });

        deleteButton.addEventListener('click', () => {
            this.deleteClip(trackId, clipId);
            this.closeClipContextMenu();
        });

        moveButton.addEventListener('click', () => {
            this.moveClipToNewTrack(trackId, clipId);
            this.closeClipContextMenu();
        });

        menu.append(duplicateButton, deleteButton, moveButton);
        this.tracksEl.appendChild(menu);

        const tracksRect = this.tracksEl.getBoundingClientRect();
        const clipRect = clipEl.getBoundingClientRect();
        const fallbackLeft = (clipRect.left - tracksRect.left) + (clipRect.width / 2);
        const fallbackTop = (clipRect.top - tracksRect.top) + (clipRect.height / 2);

        const rawLeft = pointerPosition ? (pointerPosition.clientX - tracksRect.left) : fallbackLeft;
        const rawTop = pointerPosition ? (pointerPosition.clientY - tracksRect.top) : fallbackTop;

        const menuRect = menu.getBoundingClientRect();
        const halfW = menuRect.width / 2;
        const halfH = menuRect.height / 2;

        const left = Math.max(halfW + 4, Math.min(tracksRect.width - halfW - 4, rawLeft));
        const top = Math.max(halfH + 4, Math.min(tracksRect.height - halfH - 4, rawTop));

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        this.contextMenuEl = menu;
        this.contextMenuClipRef = { trackId, clipId };
    }

    closeClipContextMenu() {
        if (!this.contextMenuEl) {
            return;
        }

        this.contextMenuEl.remove();
        this.contextMenuEl = null;
        this.contextMenuClipRef = null;
    }

    duplicateClip(trackId, clipId) {
        const track = this.tracks.find((entry) => entry.id === trackId);
        if (!track) {
            return;
        }

        const index = track.clips.findIndex((clip) => clip.id === clipId);
        if (index < 0) {
            return;
        }

        const source = track.clips[index];
        const duplicate = {
            ...source,
            id: `${source.id}-dup-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            name: `${source.name} Copy`,
            startTime: source.startTime + source.duration,
            events: (source.events || []).map((eventItem) => ({ ...eventItem }))
        };

        track.clips.splice(index + 1, 0, duplicate);
        this.selectedClipRef = { trackId, clipId: duplicate.id };
        this.renderTimeline();
        this.notifyStateChange();
    }

    deleteClip(trackId, clipId) {
        const track = this.tracks.find((entry) => entry.id === trackId);
        if (!track) {
            return;
        }

        const index = track.clips.findIndex((clip) => clip.id === clipId);
        if (index < 0) {
            return;
        }

        track.clips.splice(index, 1);
        if (this.selectedClipRef?.clipId === clipId) {
            this.selectedClipRef = null;
        }

        this.renderTimeline();
        this.notifyStateChange();
    }

    moveClipToNewTrack(trackId, clipId) {
        const track = this.tracks.find((entry) => entry.id === trackId);
        if (!track) {
            return;
        }

        const index = track.clips.findIndex((clip) => clip.id === clipId);
        if (index < 0) {
            return;
        }

        const [clip] = track.clips.splice(index, 1);
        const newTrack = this.createTrack(`Track ${this.tracks.length + 1}`, track.type || 'audio');
        newTrack.clips.push(clip);
        this.tracks.push(newTrack);

        this.activeTrackId = newTrack.id;
        this.selectedClipRef = { trackId: newTrack.id, clipId: clip.id };
        this.renderTimeline();
        this.notifyStateChange();
    }

    updatePlayheadVisual() {
        if (!this.playheadEl) {
            return;
        }

        this.playheadEl.style.left = `${this.timeToPx(this.playheadTime)}px`;
    }

    timeToPx(seconds) {
        return seconds * PX_PER_SECOND;
    }

    pxToTime(px) {
        return px / PX_PER_SECOND;
    }

    notifyStateChange() {
        const activeTrack = this.tracks.find((track) => track.id === this.activeTrackId) || null;

        this.onStateChange?.({
            tracks: this.tracks,
            playheadTime: this.playheadTime,
            activeTrackId: this.activeTrackId
        });

        this.onActiveTrackChange?.(activeTrack);
    }
}
