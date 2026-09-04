const DB_NAME = 'mini-daw-db';
const DB_VERSION = 2;
const SAMPLES_STORE = 'samples';
const PROJECTS_STORE = 'projects';

function normalizeRelativePath(inputPath, fallbackName) {
    const raw = String(inputPath || fallbackName || 'sample').trim();
    return raw
        .replace(/^\.+[\/\\]+/, '')
        .replace(/[\\]+/g, '/')
        .replace(/\/+/g, '/');
}

function toProjectPayload(projectState) {
    const snapshot = structuredClone(projectState || {});

    (snapshot.tracks || []).forEach((track) => {
        if (track?.preset?.drumpad?.pads) {
            track.preset.drumpad.pads = track.preset.drumpad.pads.map((pad) => ({
                ...pad,
                sampleBuffer: null
            }));
        }

        if (track?.preset?.synth) {
            track.preset.synth.sampleBuffer = null;
        }
    });

    (snapshot.presets?.drumpad || []).forEach((preset) => {
        preset.pads = (preset.pads || []).map((pad) => ({
            ...pad,
            sampleBuffer: null
        }));
    });

    (snapshot.presets?.synth || []).forEach((preset) => {
        preset.sampleBuffer = null;
    });

    return snapshot;
}

export class DawDB {
    constructor() {
        this.dbPromise = null;
    }

    async open() {
        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
                    db.createObjectStore(SAMPLES_STORE, { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
                    const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt');
                    store.createIndex('name', 'name');
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB init hiba.'));
        });

        return this.dbPromise;
    }

    async runWrite(storeName, action) {
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            action(store);

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB irasi hiba.'));
        });
    }

    async getById(storeName, id) {
        if (!id) {
            return null;
        }

        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('IndexedDB olvasasi hiba.'));
        });
    }

    async getAll(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error('IndexedDB lista hiba.'));
        });
    }

    async saveFile(file, options = {}) {
        const id = `sample-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const bytes = await file.arrayBuffer();
        const blob = new Blob([bytes], { type: file.type || 'audio/wav' });
        const relativePath = normalizeRelativePath(
            options.relativePath || file.webkitRelativePath || file.name,
            file.name
        );

        await this.runWrite(SAMPLES_STORE, (store) => {
            store.put({
                id,
                name: file.name || 'sample',
                relativePath,
                category: options.category || 'audio',
                mimeType: file.type || 'audio/wav',
                blob,
                updatedAt: Date.now()
            });
        });

        return id;
    }

    async getBlob(sampleId) {
        const record = await this.getById(SAMPLES_STORE, sampleId);
        return record?.blob || null;
    }

    async listSamples() {
        const all = await this.getAll(SAMPLES_STORE);
        return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    async deleteSample(sampleId) {
        await this.runWrite(SAMPLES_STORE, (store) => {
            store.delete(sampleId);
        });
    }

    async saveProject(projectName, projectState) {
        const safeName = (projectName || '').trim() || 'Untitled Project';
        const now = Date.now();
        const id = `project-${now}-${Math.random().toString(16).slice(2, 8)}`;

        const payload = {
            id,
            name: safeName,
            updatedAt: now,
            createdAt: now,
            data: toProjectPayload(projectState)
        };

        await this.runWrite(PROJECTS_STORE, (store) => {
            store.put(payload);
        });

        return payload;
    }

    async listProjects() {
        const all = await this.getAll(PROJECTS_STORE);
        return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    async loadProject(projectId) {
        return this.getById(PROJECTS_STORE, projectId);
    }
}
