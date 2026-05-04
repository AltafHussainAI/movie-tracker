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

const STORAGE_KEY = 'movieTrackerData';
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
        await db.collection('movies').doc('data').set({
            movies: data,
            updatedAt: new Date().toISOString()
        });
        const now = new Date().toLocaleTimeString();
        console.log('✅ Backed up to Firebase at ' + now + ':', data.length, 'items');
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
            if (Array.isArray(data) && data.length > 0) {
                console.log('✅ Restored from Firebase:', data.length, 'items');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

async function loadDataWithCloudRestore() {
    const local = loadData();
    if (local !== null) return local;

    showSaveIndicator('Restoring from cloud…', '☁️');
    const cloud = await restoreFromFirebase();
    if (cloud) {
        showSaveIndicator('Restored from cloud!', '✅');
        return cloud;
    }

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

window.manualBackupNow = manualBackupNow;
