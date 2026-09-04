export class MixerUI {
    constructor({ container, onTrackMixChange }) {
        this.container = container;
        this.onTrackMixChange = onTrackMixChange;
    }

    render(tracks = [], activeTrackId = null) {
        if (!this.container) {
            return;
        }

        this.container.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'mixer-list';

        tracks.forEach((track, index) => {
            const card = document.createElement('article');
            card.className = `mixer-track ${track.id === activeTrackId ? 'is-active' : ''}`;

            const header = document.createElement('div');
            header.className = 'mixer-track-header';

            const title = document.createElement('h3');
            title.textContent = track.name || `Track ${index + 1}`;

            const value = document.createElement('span');
            value.className = 'mixer-volume-value';
            value.textContent = `${Math.round((track.volume ?? 1) * 100)}%`;

            header.append(title, value);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.01';
            slider.value = String(Math.min(1, Math.max(0, Number(track.volume ?? 1))));
            slider.setAttribute('aria-label', `${track.name} hangero`);
            slider.className = 'mixer-volume-slider';

            const updateVolume = () => {
                const nextVolume = Math.min(1, Math.max(0, Number(slider.value) || 0));
                value.textContent = `${Math.round(nextVolume * 100)}%`;
                this.onTrackMixChange?.(track.id, { volume: nextVolume });
            };

            slider.addEventListener('input', updateVolume);

            slider.addEventListener('pointerdown', (event) => {
                if (!event.isPrimary) {
                    return;
                }

                slider.setPointerCapture(event.pointerId);
                updateVolume();
            });

            slider.addEventListener('pointermove', (event) => {
                if (!event.isPrimary || !slider.hasPointerCapture(event.pointerId)) {
                    return;
                }

                updateVolume();
            });

            const releasePointer = (event) => {
                if (slider.hasPointerCapture(event.pointerId)) {
                    slider.releasePointerCapture(event.pointerId);
                }
                updateVolume();
            };

            slider.addEventListener('pointerup', releasePointer);
            slider.addEventListener('pointercancel', releasePointer);

            const toggles = document.createElement('div');
            toggles.className = 'mixer-toggles';

            const muteButton = document.createElement('button');
            muteButton.type = 'button';
            muteButton.className = `mixer-toggle ${track.muted ? 'is-on' : ''}`;
            muteButton.textContent = 'Mute';
            muteButton.addEventListener('click', () => {
                this.onTrackMixChange?.(track.id, { muted: !track.muted });
            });

            const soloButton = document.createElement('button');
            soloButton.type = 'button';
            soloButton.className = `mixer-toggle solo ${track.solo ? 'is-on' : ''}`;
            soloButton.textContent = 'Solo';
            soloButton.addEventListener('click', () => {
                this.onTrackMixChange?.(track.id, { solo: !track.solo });
            });

            toggles.append(muteButton, soloButton);
            card.append(header, slider, toggles);
            list.appendChild(card);
        });

        this.container.appendChild(list);
    }
}
