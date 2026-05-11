// =============================================
// DATA MANAGER - WITH FIREBASE AUTO-BACKUP
// =============================================

const firebaseConfig = {
    apiKey: "AIzaSyBNirB-k4ASmHIE3Zm6hluxStFh1kwOSII",
    authDomain: "movie-tracker-a2471.firebaseapp.com",
    projectId: "movie-tracker-a2471",
    storageBucket: "movie-tracker-a2471.firebasestorage.app",
    messagingSenderId: "984184348188",
    appId: "1:984184348188:web:2b3f5804052adcb77889d9"
};

const STORAGE_KEY  = 'movieTrackerData';
const GROUPS_KEY   = 'movieGroups';
const AUTO_BACKUP_INTERVAL = 30;

let _backupTimer = null;
let _pendingBackup = false;
let _db = null;

function initFirebase() {
    if (_db) return _db;
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        _db = firebase.firestore();
        console.log('✅ Firebase initialized');
        return _db;
    } catch (e) {
        console.error('❌ Firebase init error:', e);
        return null;
    }
}

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
        console.log('No data in localStorage — will try Firebase');
        return null;
    } catch (error) {
        console.error('Error loading local data:', error);
        return null;
    }
}

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        // Save current timestamp so we can compare with Firebase later
        localStorage.setItem(STORAGE_KEY + '_time', Date.now().toString());
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
    localStorage.removeItem(STORAGE_KEY + '_time');
    localStorage.removeItem(GROUPS_KEY);
    console.log('✅ Cleared all data from localStorage');
}

function formatDuration(minutes) {
    if (!minutes || isNaN(minutes)) return '0h 0m';
    const hrs  = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
}

// ── REST API helpers (work on ANY origin, including mobile LAN access) ──
const FIRESTORE_REST_BASE =
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

async function backupViaRest(data, groups, now) {
    const url = `${FIRESTORE_REST_BASE}/movies/data?key=${firebaseConfig.apiKey}`;
    const toStrVal  = s  => ({ stringValue:  s  });
    const toIntVal  = n  => ({ integerValue: String(n) });

    // Encode movies array
    const encodeMovie = m => ({
        mapValue: {
            fields: Object.fromEntries(
                Object.entries(m).map(([k, v]) => {
                    if (typeof v === 'number') return [k, toIntVal(v)];
                    if (typeof v === 'boolean') return [k, { booleanValue: v }];
                    if (v === null || v === undefined) return [k, { nullValue: null }];
                    return [k, toStrVal(String(v))];
                })
            )
        }
    });

    const body = {
        fields: {
            movies:    { arrayValue: { values: data.map(encodeMovie) } },
            groups:    { arrayValue: { values: groups.map(g => toStrVal(typeof g === 'string' ? g : JSON.stringify(g))) } },
            updatedAt: toStrVal(now)
        }
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error('REST backup failed: ' + err);
    }
    return true;
}

async function restoreViaRest() {
    const url = `${FIRESTORE_REST_BASE}/movies/data?key=${firebaseConfig.apiKey}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error('REST restore failed: ' + res.status);
    const json = await res.json();
    if (!json.fields) return null;

    const decodeValue = v => {
        if ('stringValue'  in v) return v.stringValue;
        if ('integerValue' in v) return Number(v.integerValue);
        if ('doubleValue'  in v) return Number(v.doubleValue);
        if ('booleanValue' in v) return v.booleanValue;
        if ('nullValue'    in v) return null;
        if ('mapValue'     in v) return Object.fromEntries(
            Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, decodeValue(val)])
        );
        if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeValue);
        return null;
    };

    const movies = decodeValue(json.fields.movies);
    const groups = json.fields.groups ? decodeValue(json.fields.groups) : [];
    const updatedAt = json.fields.updatedAt ? json.fields.updatedAt.stringValue : null;
    return { movies, groups, updatedAt };
}

async function backupToFirebase(data) {
    const now = new Date().toISOString();
    let groups = [];
    try { groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch(e) {}

    // Try SDK first, fall back to REST (works on all origins/devices)
    let success = false;
    try {
        const db = initFirebase();
        if (!db) throw new Error('SDK not ready');
        await db.collection('movies').doc('data').set({ movies: data, groups, updatedAt: now });
        success = true;
        console.log('✅ Backed up via SDK');
    } catch (sdkErr) {
        console.warn('⚠️ SDK backup failed, trying REST API…', sdkErr.message);
        try {
            await backupViaRest(data, groups, now);
            success = true;
            console.log('✅ Backed up via REST API');
        } catch (restErr) {
            console.error('❌ REST backup also failed:', restErr.message);
        }
    }

    if (success) {
        localStorage.setItem(STORAGE_KEY + '_time', new Date(now).getTime().toString());
        const timeStr = new Date().toLocaleTimeString();
        console.log('✅ Backed up to Firebase at ' + timeStr + ':', data.length, 'items,', groups.length, 'groups');
        showSaveIndicator('Backed up to cloud ☁️', '✅');
        return true;
    } else {
        showSaveIndicator('No internet — saved locally', '📵');
        return false;
    }
}

async function restoreFromFirebase() {
    // Try SDK first, fall back to REST API (works on all origins/devices)
    try {
        const db = initFirebase();
        if (!db) throw new Error('SDK not ready');
        const docSnap = await db.collection('movies').doc('data').get();
        if (docSnap.exists) {
            const data   = docSnap.data().movies;
            const groups = docSnap.data().groups || [];
            if (Array.isArray(data) && data.length > 0) {
                console.log('✅ Restored from Firebase (SDK):', data.length, 'items');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
                return data;
            }
        }
    } catch (sdkErr) {
        console.warn('⚠️ SDK restore failed, trying REST API...', sdkErr.message);
        try {
            const result = await restoreViaRest();
            if (result && Array.isArray(result.movies) && result.movies.length > 0) {
                console.log('✅ Restored from Firebase (REST):', result.movies.length, 'items');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(result.movies));
                localStorage.setItem(GROUPS_KEY, JSON.stringify(result.groups));
                return result.movies;
            }
        } catch (restErr) {
            console.error('❌ REST restore also failed:', restErr.message);
        }
    }
    console.warn('⚠️ No data found in Firebase');
    return null;
}

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

// ── Always sync from Firebase on load, pick the newest data ──
// Uses SDK first; falls back to Firestore REST API so it works on
// mobile / LAN access (e.g. http://192.168.x.x:8000) where the SDK
// may be blocked due to Firebase authorized-domain restrictions.
async function loadDataWithCloudRestore() {
    showSaveIndicator('Syncing from cloud…', '☁️');

    const localRaw   = localStorage.getItem(STORAGE_KEY);
    const localData  = localRaw ? JSON.parse(localRaw) : null;
    const localStamp = localStorage.getItem(STORAGE_KEY + '_time');
    const localTime  = localStamp ? parseInt(localStamp) : 0;

    let firebaseData   = null;
    let firebaseGroups = [];
    let firebaseTime   = 0;

    // 1️⃣ Try Firebase SDK
    try {
        const db = initFirebase();
        if (!db) throw new Error('SDK not ready');
        const docSnap = await db.collection('movies').doc('data').get();
        if (docSnap.exists) {
            firebaseData   = docSnap.data().movies;
            firebaseGroups = docSnap.data().groups || [];
            firebaseTime   = new Date(docSnap.data().updatedAt || 0).getTime();
            console.log('✅ Fetched from Firebase via SDK');
        }
    } catch (sdkErr) {
        console.warn('⚠️ SDK fetch failed (likely unauthorized domain on mobile) — trying REST API...', sdkErr.message);
        // 2️⃣ Fall back to Firestore REST API — no domain restrictions
        try {
            const result = await restoreViaRest();
            if (result) {
                firebaseData   = result.movies;
                firebaseGroups = result.groups || [];
                firebaseTime   = result.updatedAt ? new Date(result.updatedAt).getTime() : 0;
                console.log('✅ Fetched from Firebase via REST API');
            }
        } catch (restErr) {
            console.error('❌ REST API fetch also failed:', restErr.message);
        }
    }

    // 3️⃣ Pick the newest source
    if (Array.isArray(firebaseData) && firebaseData.length > 0) {
        if (firebaseTime >= localTime) {
            console.log('✅ Firebase data is newer (' + firebaseData.length + ' items) — using it');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(firebaseData));
            localStorage.setItem(STORAGE_KEY + '_time', firebaseTime.toString());
            localStorage.setItem(GROUPS_KEY, JSON.stringify(firebaseGroups));
            showSaveIndicator('Synced from cloud ✅', '☁️');
            return firebaseData;
        } else {
            console.log('✅ Local data is newer (' + localData.length + ' items) — keeping it');
            showSaveIndicator('Up to date ✅', '');
            return localData;
        }
    }

    // 4️⃣ Firebase unreachable — use localStorage
    console.warn('⚠️ Could not reach Firebase — using local data');
    showSaveIndicator('Offline — using local data 📵', '');
    const local = loadData();
    if (local !== null) return local;

    return null;
}

function manualBackupNow() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        showSaveIndicator('No data to backup', '❓');
        return;
    }
    const data = JSON.parse(raw);
    backupToFirebase(data);
}

// Called by list.html whenever groups change — schedules a Firebase backup
// that bundles both movies + the updated groups together.
function saveGroupsToFirebase() {
    const rawMovies = localStorage.getItem(STORAGE_KEY);
    if (!rawMovies) return;
    const data = JSON.parse(rawMovies);
    // Use scheduleBackup so it debounces rapidly-fired group changes
    scheduleBackup(data);
}

window.manualBackupNow    = manualBackupNow;
window.saveGroupsToFirebase = saveGroupsToFirebase;
