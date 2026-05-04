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

async function backupToFirebase(data) {
    try {
        const db = initFirebase();
        if (!db) throw new Error('Firebase not ready');
        const now = new Date().toISOString();
        // Read groups from localStorage to include in backup
        let groups = [];
        try { groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch(e) {}
        await db.collection('movies').doc('data').set({
            movies: data,
            groups: groups,
            updatedAt: now
        });
        // Keep local timestamp in sync with what we just saved
        localStorage.setItem(STORAGE_KEY + '_time', new Date(now).getTime().toString());
        const timeStr = new Date().toLocaleTimeString();
        console.log('✅ Backed up to Firebase at ' + timeStr + ':', data.length, 'items,', groups.length, 'groups');
        showSaveIndicator('Backed up to cloud ☁️', '✅');
        return true;
    } catch (error) {
        console.error('❌ Firebase backup error:', error);
        showSaveIndicator('No internet — saved locally', '📵');
        return false;
    }
}

async function restoreFromFirebase() {
    try {
        const db = initFirebase();
        if (!db) throw new Error('Firebase not ready');
        const docSnap = await db.collection('movies').doc('data').get();
        if (docSnap.exists) {
            const data = docSnap.data().movies;
            const groups = docSnap.data().groups || [];
            if (Array.isArray(data) && data.length > 0) {
                console.log('✅ Restored from Firebase:', data.length, 'items,', groups.length, 'groups');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
                return data;
            }
        }
        console.warn('⚠️ No data found in Firebase');
        return null;
    } catch (error) {
        console.error('❌ Firebase restore error:', error);
        return null;
    }
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

// ── FIXED: Always sync from Firebase on load, pick the newest data ──
async function loadDataWithCloudRestore() {
    showSaveIndicator('Syncing from cloud…', '☁️');

    try {
        const db = initFirebase();
        if (!db) throw new Error('Firebase not ready');

        const docSnap = await db.collection('movies').doc('data').get();

        if (docSnap.exists) {
            const firebaseData   = docSnap.data().movies;
            const firebaseGroups = docSnap.data().groups || [];
            const firebaseTime   = new Date(docSnap.data().updatedAt || 0).getTime();

            const localRaw   = localStorage.getItem(STORAGE_KEY);
            const localData  = localRaw ? JSON.parse(localRaw) : null;
            const localStamp = localStorage.getItem(STORAGE_KEY + '_time');
            const localTime  = localStamp ? parseInt(localStamp) : 0;

            if (Array.isArray(firebaseData) && firebaseData.length > 0) {
                if (firebaseTime >= localTime) {
                    // Firebase is newer — use it on ALL devices
                    console.log('✅ Firebase data is newer (' + firebaseData.length + ' items, ' + firebaseGroups.length + ' groups) — using it');
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(firebaseData));
                    localStorage.setItem(STORAGE_KEY + '_time', firebaseTime.toString());
                    localStorage.setItem(GROUPS_KEY, JSON.stringify(firebaseGroups));
                    showSaveIndicator('Synced from cloud ✅', '☁️');
                    return firebaseData;
                } else {
                    // Local is newer (just edited on this device)
                    console.log('✅ Local data is newer (' + localData.length + ' items) — keeping it');
                    showSaveIndicator('Up to date ✅', '');
                    return localData;
                }
            }
        }
    } catch (error) {
        console.error('❌ Sync error — falling back to local:', error);
    }

    // Fallback: Firebase unreachable, use localStorage
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
