// =============================================
// DATA MANAGER - WITH GITHUB GIST AUTO-BACKUP
// =============================================

const GITHUB_TOKEN = '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';
const GIST_ID      = '28384e87e0185be5e8e8a663c106c11b';
const GIST_FILE    = 'movie-data.json';
const STORAGE_KEY  = 'movieTrackerData';

// How often to auto-backup (in seconds). Default: every 30 seconds.
const AUTO_BACKUP_INTERVAL = 30;

let _backupTimer = null;
let _pendingBackup = false;

// ──────────────────────────────────────────────
// LOCAL STORAGE (fast read/write for daily use)
// ──────────────────────────────────────────────

function loadData() {
    try {
        const localData = localStorage.getItem(STORAGE_KEY);
        if (localData) {
            const parsed = JSON.parse(localData);
            if (Array.isArray(parsed)) {
                console.log('✅ Loaded from localStorage:', parsed.length, 'items');
                return parsed;
            }
        }
        console.log('No data in localStorage — will try Gist');
        return null;
    } catch (error) {
        console.error('Error loading local data:', error);
        return null;
    }
}

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('✅ Saved to localStorage:', data.length, 'items');
        scheduleBackup(data);
        return true;
    } catch (error) {
        console.error('Error saving to localStorage:', error);
        return false;
    }
}

function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('✅ Cleared all data from localStorage');
}

// ──────────────────────────────────────────────
// FORMAT HELPERS
// ──────────────────────────────────────────────

function formatDuration(minutes) {
    if (!minutes || isNaN(minutes)) return '0h 0m';
    const hrs  = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
}

// ──────────────────────────────────────────────
// GITHUB GIST BACKUP
// ──────────────────────────────────────────────

function isGistConfigured() {
    return GITHUB_TOKEN !== 'YOUR_GITHUB_TOKEN_HERE' &&
           GIST_ID      !== 'YOUR_GIST_ID_HERE';
}

// Save data to GitHub Gist
async function backupToGist(data) {
    if (!isGistConfigured()) {
        console.warn('⚠️ Gist not configured — skipping backup');
        return false;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: {
                    [GIST_FILE]: {
                        content: JSON.stringify(data, null, 2)
                    }
                }
            })
        });

        if (response.ok) {
            const now = new Date().toLocaleTimeString();
            console.log(`✅ Backed up to Gist at ${now}:`, data.length, 'items');
            showSaveIndicator('Backed up to cloud ☁️', '✅');
            return true;
        } else {
            const err = await response.json();
            console.error('❌ Gist backup failed:', err.message);
            showSaveIndicator('Backup failed — check token', '⚠️');
            return false;
        }
    } catch (error) {
        console.error('❌ Gist backup error:', error);
        showSaveIndicator('No internet — saved locally', '📵');
        return false;
    }
}

// Load data from GitHub Gist (used on first load if localStorage is empty)
async function restoreFromGist() {
    if (!isGistConfigured()) return null;

    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });

        if (!response.ok) {
            console.warn('⚠️ Could not reach Gist:', response.status);
            return null;
        }

        const gist = await response.json();
        const file = gist.files?.[GIST_FILE];

        if (!file?.content) {
            console.warn('⚠️ Gist file is empty or missing');
            return null;
        }

        const data = JSON.parse(file.content);
        if (Array.isArray(data) && data.length > 0) {
            console.log('✅ Restored from Gist:', data.length, 'items');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return data;
        }

        return null;
    } catch (error) {
        console.error('❌ Gist restore error:', error);
        return null;
    }
}

// Schedule a backup — waits AUTO_BACKUP_INTERVAL seconds after last save
// (prevents hammering the API on every keystroke)
function scheduleBackup(data) {
    _pendingBackup = true;

    if (_backupTimer) clearTimeout(_backupTimer);

    _backupTimer = setTimeout(() => {
        if (_pendingBackup) {
            _pendingBackup = false;
            backupToGist(data);
        }
    }, AUTO_BACKUP_INTERVAL * 1000);
}

// ──────────────────────────────────────────────
// ENHANCED LOAD — tries localStorage, then Gist
// ──────────────────────────────────────────────

async function loadDataWithCloudRestore() {
    // 1. Try localStorage first (instant)
    const local = loadData();
    if (local !== null) return local;

    // 2. localStorage is empty → try restoring from Gist
    if (isGistConfigured()) {
        showSaveIndicator('Restoring from cloud…', '☁️');
        const cloud = await restoreFromGist();
        if (cloud) {
            showSaveIndicator('Restored from cloud!', '✅');
            return cloud;
        }
    }

    return null;
}

// ──────────────────────────────────────────────
// MANUAL BACKUP BUTTON (optional)
// ──────────────────────────────────────────────

function manualBackupNow() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        showSaveIndicator('No data to backup', '❓');
        return;
    }
    const data = JSON.parse(raw);
    backupToGist(data);
}

// Expose for inline onclick use
window.manualBackupNow = manualBackupNow;
