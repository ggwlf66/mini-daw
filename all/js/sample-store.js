const DB_NAME = 'mini-daw-db';
const DB_VERSION = 1;
const STORE_NAME = 'samples';

export class SampleStore {
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
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB init hiba.'));
        });

        return this.dbPromise;
    }

    async saveFile(file) {
        const db = await this.open();
        const id = `sample-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const bytes = await file.arrayBuffer();
        const blob = new Blob([bytes], { type: file.type || 'audio/wav' });

        await this.runWrite(db, (store) => {
            store.put({
                id,
                name: file.name || 'sample',
                mimeType: file.type || 'audio/wav',
                blob,
                updatedAt: Date.now()
            });
        });

        return id;
    }

    async getBlob(sampleId) {
        if (!sampleId) {
            return null;
        }

        const db = await this.open();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(sampleId);

            request.onsuccess = () => {
                const record = request.result;
                resolve(record?.blob || null);
            };
            request.onerror = () => reject(request.error || new Error('Sample betoltesi hiba.'));
        });
    }

    async runWrite(db, action) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);

            action(store);

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB irasi hiba.'));
        });
    }
}
