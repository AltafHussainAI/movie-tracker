// =============================================
// DATA MANAGER - FIREBASE REST API ONLY
// Works on ANY device / origin (mobile, PC, LAN IP, etc.)
// No Firebase SDK required — uses Firestore REST + API key only
// =============================================

const firebaseConfig = {
    apiKey:    "AIzaSyBNirB-k4ASmHIE3Zm6hluxStFh1kwOSII",
    projectId: "movie-tracker-a2471"
};

const STORAGE_KEY          = 'movieTrackerData';
const GROUPS_KEY           = 'movieGroups';
const AUTO_BACKUP_INTERVAL = 30;   // seconds before a pending backup fires
const POLL_INTERVAL        = 30;   // seconds between background sync checks

const FIRESTORE_DOC =
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}` +
    `/databases/(default)/documents/movies/data?key=${firebaseConfig.apiKey}`;

let _backupTimer   = null;
let _pendingBackup = false;
let _pollTimer     = null;

// ─────────────────────────────────────────────
//  Firestore value encoders / decoders
// ─────────────────────────────────────────────
function _encodeValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean')        return { booleanValue: v };
    if (typeof v === 'number')         return Number.isInteger(v)
                                           ? { integerValue: String(v) }
                                           : { doubleValue: v };
    if (typeof v === 'string')         return { stringValue: v };
    if (Array.isArray(v))              return { arrayValue: { values: v.map(_encodeValue) } };
    if (typeof v === 'object')         return {
        mapValue: {
            fields: Object.fromEntries(
                Object.entries(v).map(([k, val]) => [k, _encodeValue(val)])
            )
        }
    };
    return { stringValue: String(v) };
}

function _decodeValue(v) {
    if ('nullValue'    in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return Number(v.doubleValue);
    if ('stringValue'  in v) return v.stringValue;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(_decodeValue);
    if ('mapValue'     in v) return Object.fromEntries(
        Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, _decodeValue(val)])
    );
    return null;
}

// ─────────────────────────────────────────────
//  Core REST calls
// ─────────────────────────────────────────────
async function _firestoreGet() {
    const res = await fetch(FIRESTORE_DOC);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GET failed: ' + res.status + ' ' + await res.text());
    const json = await res.json();
    if (!json.fields) return null;
    return {
        movies:    _decodeValue(json.fields.movies    || { arrayValue: {} }),
        groups:    _decodeValue(json.fields.groups    || { arrayValue: {} }),
        updatedAt: json.fields.updatedAt ? json.fields.updatedAt.stringValue : null
    };
}

async function _firestorePatch(movies, groups, now) {
    const body = {
        fields: {
            movies:    _encodeValue(movies),
            groups:    _encodeValue(groups),
            updatedAt: _encodeValue(now)
        }
    };
    const res = await fetch(FIRESTORE_DOC, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    });
    if (!res.ok) throw new Error('PATCH failed: ' + res.status + ' ' + await res.text());
    return true;
}

// ─────────────────────────────────────────────
//  localStorage helpers
// ─────────────────────────────────────────────
function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                console.log('✅ Loaded from localStorage:', parsed.length, 'items');
                return parsed;
            }
        }
        return null;
    } catch (e) {
        console.error('Error reading localStorage:', e);
        return null;
    }
}

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        localStorage.setItem(STORAGE_KEY + '_time', Date.now().toString());
        console.log('✅ Saved to localStorage:', data.length, 'items');
        scheduleBackup(data);
        return true;
    } catch (e) {
        console.error('Error writing localStorage:', e);
        return false;
    }
}

function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + '_time');
    localStorage.removeItem(GROUPS_KEY);
    console.log('✅ Cleared all local data');
}

function formatDuration(minutes) {
    if (!minutes || isNaN(minutes)) return '0h 0m';
    const hrs  = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
}

// ─────────────────────────────────────────────
//  Backup to Firebase
// ─────────────────────────────────────────────
async function backupToFirebase(data) {
    const now = new Date().toISOString();
    let groups = [];
    try { groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch(e) {}

    try {
        await _firestorePatch(data, groups, now);
        localStorage.setItem(STORAGE_KEY + '_time', new Date(now).getTime().toString());
        console.log('✅ Backed up to Firebase at', new Date().toLocaleTimeString(),
                    '-', data.length, 'items,', groups.length, 'groups');
        showSaveIndicator('Backed up to cloud', '✅');
        return true;
    } catch (err) {
        console.error('❌ Firebase backup error:', err.message);
        showSaveIndicator('No internet — saved locally', '📵');
        return false;
    }
}

// ─────────────────────────────────────────────
//  Restore from Firebase
// ─────────────────────────────────────────────
async function restoreFromFirebase() {
    try {
        const result = await _firestoreGet();
        if (result && Array.isArray(result.movies) && result.movies.length > 0) {
            console.log('✅ Restored from Firebase:', result.movies.length, 'items');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(result.movies));
            localStorage.setItem(GROUPS_KEY,  JSON.stringify(result.groups));
            return result.movies;
        }
        console.warn('No data found in Firebase');
        return null;
    } catch (err) {
        console.error('❌ Firebase restore error:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
//  Debounced backup scheduler
// ─────────────────────────────────────────────
function scheduleBackup(data) {
    _pendingBackup = true;
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => {
        if (_pendingBackup) {
            _pendingBackup = false;
            backupToFirebase(data);
        }
    }, AUTO_BACKUP_INTERVAL * 1000);
}

// ─────────────────────────────────────────────
//  Initial load — pull from Firebase,
//  keep whichever copy is newer
// ─────────────────────────────────────────────
async function loadDataWithCloudRestore() {
    showSaveIndicator('Syncing from cloud…', '☁️');

    const localRaw   = localStorage.getItem(STORAGE_KEY);
    const localData  = localRaw ? JSON.parse(localRaw) : null;
    const localStamp = localStorage.getItem(STORAGE_KEY + '_time');
    const localTime  = localStamp ? parseInt(localStamp) : 0;

    try {
        const result = await _firestoreGet();

        if (result && Array.isArray(result.movies) && result.movies.length > 0) {
            const firebaseTime = result.updatedAt ? new Date(result.updatedAt).getTime() : 0;

            if (firebaseTime >= localTime) {
                console.log('✅ Firebase is newer (' + result.movies.length + ' items) — using it');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(result.movies));
                localStorage.setItem(STORAGE_KEY + '_time', firebaseTime.toString());
                localStorage.setItem(GROUPS_KEY,  JSON.stringify(result.groups));
                showSaveIndicator('Synced from cloud ✅', '☁️');
                return result.movies;
            } else {
                console.log('✅ Local is newer (' + localData.length + ' items) — keeping it');
                showSaveIndicator('Up to date ✅', '');
                return localData;
            }
        }
    } catch (err) {
        console.error('❌ Sync error — falling back to local:', err.message);
        showSaveIndicator('Offline — using local data 📵', '');
    }

    return loadData();
}

// ─────────────────────────────────────────────
//  Background polling — keeps open tabs in sync
//  when another device makes changes
// ─────────────────────────────────────────────
function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(async () => {
        if (_pendingBackup) return;

        const localStamp = localStorage.getItem(STORAGE_KEY + '_time');
        const localTime  = localStamp ? parseInt(localStamp) : 0;

        try {
            const result = await _firestoreGet();
            if (!result || !Array.isArray(result.movies) || result.movies.length === 0) return;

            const firebaseTime = result.updatedAt ? new Date(result.updatedAt).getTime() : 0;
            if (firebaseTime > localTime) {
                console.log('🔄 Poll: newer data found — updating');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(result.movies));
                localStorage.setItem(STORAGE_KEY + '_time', firebaseTime.toString());
                localStorage.setItem(GROUPS_KEY,  JSON.stringify(result.groups));
                showSaveIndicator('Updated from cloud 🔄', '☁️');

                if (typeof window._onFirebaseUpdate === 'function') {
                    window._onFirebaseUpdate(result.movies, result.groups);
                }
            }
        } catch (e) { /* silent — network blip */ }
    }, POLL_INTERVAL * 1000);

    console.log('✅ Background sync started (every ' + POLL_INTERVAL + 's)');
}

startPolling();

// ─────────────────────────────────────────────
//  Public helpers
// ─────────────────────────────────────────────
function manualBackupNow() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { showSaveIndicator('No data to backup', '❓'); return; }
    backupToFirebase(JSON.parse(raw));
}

function saveGroupsToFirebase() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    scheduleBackup(JSON.parse(raw));
}

window.manualBackupNow      = manualBackupNow;
window.saveGroupsToFirebase  = saveGroupsToFirebase;
