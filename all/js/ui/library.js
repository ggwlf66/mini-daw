function escapeCssPart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizePath(pathValue, fallbackName = 'sample') {
    const raw = String(pathValue || fallbackName).trim();
    return raw
        .replace(/^\.+[\\/]+/, '')
        .replace(/[\\]+/g, '/')
        .replace(/\/+/g, '/');
}

function buildFolderTree(samples) {
    const root = {
        kind: 'folder',
        name: '',
        path: '',
        folders: new Map(),
        files: []
    };

    samples.forEach((sample) => {
        const relPath = normalizePath(sample.relativePath || sample.name, sample.name);
        const parts = relPath.split('/').filter(Boolean);
        const fileName = parts.pop() || sample.name || 'sample';

        let cursor = root;
        let pathCursor = '';
        parts.forEach((segment) => {
            pathCursor = pathCursor ? `${pathCursor}/${segment}` : segment;
            if (!cursor.folders.has(segment)) {
                cursor.folders.set(segment, {
                    kind: 'folder',
                    name: segment,
                    path: pathCursor,
                    folders: new Map(),
                    files: []
                });
            }
            cursor = cursor.folders.get(segment);
        });

        cursor.files.push({
            ...sample,
            displayName: fileName,
            relativePath: relPath
        });
    });

    return root;
}

function sortTree(node) {
    const sortedFolders = [...node.folders.values()]
        .sort((a, b) => a.name.localeCompare(b.name));

    sortedFolders.forEach(sortTree);
    node.folders = sortedFolders;
    node.files = [...node.files].sort((a, b) => {
        return (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '');
    });

    return node;
}

function makeFolderNode(folder, state) {
    const folderItem = document.createElement('li');
    folderItem.className = 'library-tree-folder-item';
    folderItem.dataset.folderPath = folder.path;

    const isExpanded = state.expandedFolders.has(folder.path);
    if (!isExpanded) {
        folderItem.classList.add('collapsed');
    }

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'library-folder-header';
    header.dataset.folderPath = folder.path;

    const arrow = document.createElement('i');
    arrow.className = `fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} library-folder-arrow`;
    arrow.setAttribute('aria-hidden', 'true');

    const folderIcon = document.createElement('i');
    folderIcon.className = 'fas fa-folder library-folder-icon';
    folderIcon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = folder.name;

    header.append(arrow, folderIcon, label);
    folderItem.appendChild(header);

    const children = document.createElement('ul');
    children.className = 'library-tree-children';

    folder.folders.forEach((childFolder) => {
        children.appendChild(makeFolderNode(childFolder, state));
    });

    folder.files.forEach((sample) => {
        const sampleItem = document.createElement('li');
        sampleItem.className = 'library-tree-sample-item';

        const row = document.createElement('div');
        row.className = 'library-tree-row library-sample-row';
        row.dataset.sampleId = sample.id;

        const pickButton = document.createElement('button');
        pickButton.type = 'button';
        pickButton.className = 'library-sample-pick';
        pickButton.dataset.sampleId = sample.id;
        pickButton.innerHTML = `<i class="fas fa-wave-square me-1" aria-hidden="true"></i>${sample.displayName || sample.name || 'sample'}`;

        const actions = document.createElement('div');
        actions.className = 'library-item-actions';

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'library-action-btn';
        playButton.dataset.samplePreviewId = sample.id;
        playButton.textContent = 'Play';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'library-action-btn is-danger';
        deleteButton.dataset.sampleDeleteId = sample.id;
        deleteButton.textContent = 'Delete';

        actions.append(playButton, deleteButton);
        row.append(pickButton, actions);
        sampleItem.appendChild(row);
        children.appendChild(sampleItem);
    });

    folderItem.appendChild(children);
    return folderItem;
}

export function initLibraryUI({
    container,
    onPreviewSample,
    onDeleteSample,
    onPickSample,
    onStatusChange
}) {
    if (!container) {
        return null;
    }

    const state = {
        samples: [],
        pickerMode: null,
        expandedFolders: new Set()
    };

    function setSamples(samples) {
        state.samples = Array.isArray(samples) ? samples : [];
        render();
    }

    function setPickerMode(pickerMode) {
        state.pickerMode = pickerMode || null;
        render();
    }

    function getPickerMode() {
        return state.pickerMode;
    }

    function toggleFolder(path) {
        if (!path) {
            return;
        }

        if (state.expandedFolders.has(path)) {
            state.expandedFolders.delete(path);
        } else {
            state.expandedFolders.add(path);
        }

        render();
    }

    function render() {
        container.innerHTML = '';
        container.classList.toggle('is-picker-mode', Boolean(state.pickerMode));

        if (state.pickerMode) {
            const pickerHint = document.createElement('p');
            pickerHint.className = 'library-picker-hint';
            pickerHint.textContent = `Pick mode: ${state.pickerMode.label || 'Select sample'}`;
            container.appendChild(pickerHint);
        }

        if (!state.samples.length) {
            const empty = document.createElement('p');
            empty.className = 'library-empty';
            empty.textContent = 'Nincs minta a tarban.';
            container.appendChild(empty);
            return;
        }

        const treeRoot = sortTree(buildFolderTree(state.samples));
        const topLevelFolderPaths = treeRoot.folders.map((folder) => folder.path);
        if (state.expandedFolders.size === 0) {
            topLevelFolderPaths.forEach((path) => state.expandedFolders.add(path));
        }

        const tree = document.createElement('ul');
        tree.className = 'library-tree';
        treeRoot.folders.forEach((folder) => {
            tree.appendChild(makeFolderNode(folder, state));
        });

        treeRoot.files.forEach((sample) => {
            const sampleItem = document.createElement('li');
            sampleItem.className = 'library-tree-sample-item';

            const row = document.createElement('div');
            row.className = 'library-tree-row library-sample-row';
            row.dataset.sampleId = sample.id;

            const pickButton = document.createElement('button');
            pickButton.type = 'button';
            pickButton.className = 'library-sample-pick';
            pickButton.dataset.sampleId = sample.id;
            pickButton.innerHTML = `<i class="fas fa-wave-square me-1" aria-hidden="true"></i>${sample.displayName || sample.name || 'sample'}`;

            const actions = document.createElement('div');
            actions.className = 'library-item-actions';

            const playButton = document.createElement('button');
            playButton.type = 'button';
            playButton.className = 'library-action-btn';
            playButton.dataset.samplePreviewId = sample.id;
            playButton.textContent = 'Play';

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'library-action-btn is-danger';
            deleteButton.dataset.sampleDeleteId = sample.id;
            deleteButton.textContent = 'Delete';

            actions.append(playButton, deleteButton);
            row.append(pickButton, actions);
            sampleItem.appendChild(row);
            tree.appendChild(sampleItem);
        });

        container.appendChild(tree);
    }

    container.addEventListener('click', (event) => {
        const folderControl = event.target.closest('.library-folder-header[data-folder-path]');
        if (folderControl) {
            toggleFolder(folderControl.dataset.folderPath || '');
            return;
        }

        const previewControl = event.target.closest('[data-sample-preview-id]');
        if (previewControl) {
            const sampleId = previewControl.dataset.samplePreviewId;
            const sample = state.samples.find((entry) => entry.id === sampleId);
            if (!sample) {
                return;
            }

            onPreviewSample?.(sample).catch((error) => {
                onStatusChange?.(`Preview hiba: ${error.message}`, true);
            });
            return;
        }

        const deleteControl = event.target.closest('[data-sample-delete-id]');
        if (deleteControl) {
            const sampleId = deleteControl.dataset.sampleDeleteId;
            const sample = state.samples.find((entry) => entry.id === sampleId);
            if (!sample) {
                return;
            }

            onDeleteSample?.(sample).catch((error) => {
                onStatusChange?.(`Torles hiba: ${error.message}`, true);
            });
            return;
        }

        const pickControl = event.target.closest('[data-sample-id]');
        if (pickControl) {
            const sampleId = pickControl.dataset.sampleId;
            const sample = state.samples.find((entry) => entry.id === sampleId);
            if (!sample) {
                return;
            }

            if (state.pickerMode) {
                onPickSample?.(sample, state.pickerMode).catch((error) => {
                    onStatusChange?.(`Pick hiba: ${error.message}`, true);
                });
            }
        }
    });

    return {
        setSamples,
        setPickerMode,
        getPickerMode,
        render
    };
}
