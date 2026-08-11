// State Management
let logs = [];
let activeShift = null;
let liveTimerInterval = null;
let lastAddedTickerInterval = null;

// DOM Elements & Virtual Proxies
const clockElement = document.getElementById('current-date-time');
const shiftDateInput = document.getElementById('shift-date');
const btnStartShift = document.getElementById('btn-start-shift');
const btnEndShift = document.getElementById('btn-end-shift');
const shiftStatusText = document.getElementById('shift-status-text');
const shiftDurationTimer = document.getElementById('shift-duration-timer');

const counterDisplay = document.getElementById('counter-display');
const btnPlusTask = document.getElementById('btn-plus-task');
const btnMinusTask = document.getElementById('btn-minus-task');
const counterAuditLog = document.getElementById('counter-audit-log');

// --- TIME STEPPER HELPERS ---

function getStepperTime(prefix) {
    const h = document.getElementById(`${prefix}-hour`);
    const m = document.getElementById(`${prefix}-min`);
    if (!h || !m) return '00:00';
    const hv = String(Math.min(23, Math.max(0, parseInt(h.value) || 0))).padStart(2, '0');
    const mv = String(Math.min(59, Math.max(0, parseInt(m.value) || 0))).padStart(2, '0');
    return `${hv}:${mv}`;
}

function setStepperTime(prefix, timeStr) {
    if (!timeStr || timeStr === '--:--') timeStr = '00:00';
    const [h, m] = timeStr.split(':').map(Number);
    const hEl = document.getElementById(`${prefix}-hour`);
    const mEl = document.getElementById(`${prefix}-min`);
    if (hEl) hEl.value = h;
    if (mEl) mEl.value = m;
}

function setStepperDisabled(prefix, disabled) {
    const stepper = document.getElementById(`${prefix}-stepper`);
    if (!stepper) return;
    stepper.querySelectorAll('input, button').forEach(el => {
        el.disabled = disabled;
    });
    stepper.style.opacity = disabled ? '0.45' : '1';
    stepper.style.pointerEvents = disabled ? 'none' : '';
}

function initSteppers() {
    const prefixes = ['shift-start', 'shift-end', 'edit-start', 'edit-end'];
    prefixes.forEach(prefix => {
        const hourInput = document.getElementById(`${prefix}-hour`);
        const minInput  = document.getElementById(`${prefix}-min`);
        if (!hourInput || !minInput) return;

        // Clamp on manual input
        hourInput.addEventListener('change', () => {
            let v = parseInt(hourInput.value);
            if (isNaN(v)) v = 0;
            hourInput.value = Math.min(23, Math.max(0, v));
            if (prefix === 'shift-end' && activeShift) {
                activeShift.plannedEndTime = getStepperTime(prefix);
                saveData();
            }
            if (prefix.startsWith('shift')) checkDailyLimitWarning();
        });
        minInput.addEventListener('change', () => {
            let v = parseInt(minInput.value);
            if (isNaN(v)) v = 0;
            minInput.value = Math.min(59, Math.max(0, v));
            if (prefix === 'shift-end' && activeShift) {
                activeShift.plannedEndTime = getStepperTime(prefix);
                saveData();
            }
            if (prefix.startsWith('shift')) checkDailyLimitWarning();
        });

        // ▲ / ▼ buttons
        const wire = (btnId, input, max, dir) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', () => {
                let v = parseInt(input.value) || 0;
                v = ((v + dir) + max + 1) % (max + 1); // wrap-around
                input.value = v;
                if (prefix === 'shift-end' && activeShift) {
                    activeShift.plannedEndTime = getStepperTime(prefix);
                    saveData();
                }
                if (prefix.startsWith('shift')) checkDailyLimitWarning();
            });
        };
        wire(`${prefix}-hour-up`,   hourInput, 23, +1);
        wire(`${prefix}-hour-down`, hourInput, 23, -1);
        wire(`${prefix}-min-up`,    minInput,  59, +1);
        wire(`${prefix}-min-down`,  minInput,  59, -1);
    });
}

function checkDailyLimitWarning() {
    const warningEl = document.getElementById('end-time-limit-warning');
    if (!warningEl) return;

    const dateVal = shiftDateInput.value;
    if (!dateVal) {
        warningEl.style.display = 'none';
        return;
    }

    let completedHours = 0;
    logs.forEach(log => {
        if (log.date === dateVal) {
            completedHours += log.duration;
        }
    });

    const startVal = getStepperTime('shift-start');
    const endVal = getStepperTime('shift-end');
    const currentPlanDuration = getDurationHours(startVal, endVal);

    const totalHours = completedHours + currentPlanDuration;

    if (totalHours > 10) {
        const excess = totalHours - 10;
        const excessHrs = Math.floor(excess);
        const excessMins = Math.round((excess - excessHrs) * 60);
        
        let timeStr = '';
        if (excessHrs > 0) timeStr += `${excessHrs}h `;
        if (excessMins > 0) timeStr += `${excessMins}m`;
        
        warningEl.textContent = `⚠️ Plan exceeds 10h daily limit by ${timeStr.trim()}`;
        warningEl.style.display = 'block';
    } else {
        warningEl.style.display = 'none';
    }
}

// Virtual inputs — thin wrappers over the stepper inputs
const shiftStartInput = {
    get value() { return getStepperTime('shift-start'); },
    set value(val) { setStepperTime('shift-start', val); },
    set disabled(val) { setStepperDisabled('shift-start', val); }
};

const shiftEndInput = {
    get value() { return getStepperTime('shift-end'); },
    set value(val) {
        setStepperTime('shift-end', val);
        if (activeShift && val) { activeShift.plannedEndTime = val; saveData(); }
    },
    set disabled(val) { setStepperDisabled('shift-end', val); }
};

const editStartInput = {
    get value() { return getStepperTime('edit-start'); },
    set value(val) { setStepperTime('edit-start', val); }
};

const editEndInput = {
    get value() { return getStepperTime('edit-end'); },
    set value(val) { setStepperTime('edit-end', val); }
};


const statTotalTasks = document.getElementById('stat-total-tasks');
const statTotalHours = document.getElementById('stat-total-hours');
const statAvgRate = document.getElementById('stat-avg-rate');

const filterStartDate = document.getElementById('filter-start-date');
const filterEndDate = document.getElementById('filter-end-date');
const btnResetFilters = document.getElementById('btn-reset-filters');

const btnExportCsv = document.getElementById('btn-export-csv');
const btnExportJson = document.getElementById('btn-export-json');
const btnImportJson = document.getElementById('btn-import-json');
const fileImportInput = document.getElementById('file-import-input');

const logsTbody = document.getElementById('logs-tbody');
const emptyState = document.getElementById('empty-state');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const editIndexInput = document.getElementById('edit-index');
const editDateInput = document.getElementById('edit-date');
const editTasksInput = document.getElementById('edit-tasks');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnSaveEdit = document.getElementById('btn-save-edit');

const toastContainer = document.getElementById('toast-container');

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Wire up stepper buttons
    initSteppers();

    // 2. Start system clock
    updateSystemClock();
    setInterval(updateSystemClock, 1000);

    // 3. Load data from localStorage
    loadData();

    // 4. Set default shift date and initial start time (Filter shows ALL logs by default)
    const todayStr = getTodayDateString();
    if (shiftDateInput) shiftDateInput.value = todayStr;
    if (filterStartDate) filterStartDate.value = '';
    if (filterEndDate) filterEndDate.value = '';
    setStepperTime('shift-start', getCurrentTimeString());

    // 5. Initialize event listeners
    initEventListeners();

    // 6. Fetch live exchange rate (USD to IDR)
    fetchExchangeRate();

    // 7. Restore active shift if exists
    if (activeShift) {
        resumeActiveShift();
    } else {
        updateUIForInactiveShift();
    }

    // 8. Initial render of history and statistics
    renderLogs();

    // 9. Periodic Live Cloud Polling (Every 10 seconds for seamless HP-Laptop sync)
    setInterval(fetchFromCloud, 10000);
});

// --- EXCHANGE RATE STATE & HELPERS ---
let usdToIdrRate = 16000; // Fallback rate

async function fetchExchangeRate() {
    const el = document.getElementById('rate-exchange-info');
    if (el) el.textContent = `Rate: $1 = Rp 16.250`;

    try {
        let res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) {
            res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        }
        const data = await res.json();
        if (data && data.rates && data.rates.IDR) {
            usdToIdrRate = data.rates.IDR;
            const formatted = new Intl.NumberFormat('id-ID').format(Math.round(usdToIdrRate));
            if (el) el.textContent = `Rate: $1 = Rp ${formatted}`;
            renderLogs();
        }
    } catch (e) {
        console.warn('Failed to fetch live USD/IDR rate, using fallback', e);
        if (el) el.textContent = `Rate: $1 = Rp 16.250`;
    }
}

function formatPaymentIDR(usdValue) {
    const idrValue = usdValue * usdToIdrRate;
    // Format to currency IDR style (e.g. Rp 240.000) without decimals
    return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(idrValue));
}

// --- HELPER FUNCTIONS ---

// Update header date and time
function updateSystemClock() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const datePart = now.toLocaleDateString('id-ID', options);
    const timePart = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockElement.textContent = `${datePart} - ${timePart}`;
}

// Get date in YYYY-MM-DD
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get time in HH:MM
function getCurrentTimeString() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Show custom toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '';
    if (type === 'success') {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'danger') {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="9" x2="12.01" y2="9"></line></svg>`;
    }

    toast.innerHTML = `${icon} <span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    // Auto-remove toast
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(120%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// --- FILE SYSTEM ACCESS & INDEXEDDB SYNC ---
let dirHandle = null;

function getIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('MultimangoStore', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getStoredDirHandle() {
    try {
        const db = await getIDB();
        return new Promise((resolve) => {
            const tx = db.transaction('handles', 'readonly');
            const store = tx.objectStore('handles');
            const req = store.get('syncDir');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

async function storeDirHandle(handle) {
    try {
        const db = await getIDB();
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'syncDir');
    } catch (e) {
        console.error('Failed to save handle to IDB', e);
    }
}

async function updateSyncFolderUI() {
    const label = document.getElementById('sync-folder-label');
    const btn = document.getElementById('btn-sync-folder');
    if (!label || !btn) return;

    if (dirHandle) {
        label.textContent = `Synced: ${dirHandle.name}`;
        btn.classList.add('synced');
        btn.title = `Data auto-syncing to ${dirHandle.name}/timetracker_data.json`;
    } else {
        label.textContent = 'Link Folder';
        btn.classList.remove('synced');
        btn.title = 'Click to link local folder for cross-browser auto-sync';
    }
}

async function selectSyncFolder() {
    if (!('showDirectoryPicker' in window)) {
        showToast('File System Access API is not supported in this browser.', 'danger');
        return;
    }
    try {
        dirHandle = await window.showDirectoryPicker();
        await storeDirHandle(dirHandle);
        await updateSyncFolderUI();
        showToast(`Linked folder: ${dirHandle.name}. Syncing data...`, 'success');
        
        // Try reading existing file if available, or write current data
        const readSuccess = await loadFromFileSystem();
        if (!readSuccess) {
            await saveToFileSystem();
        } else {
            renderLogs();
            if (activeShift) resumeActiveShift();
            else updateUIForInactiveShift();
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            showToast('Failed to select directory', 'danger');
        }
    }
}

async function verifyPermission(fileHandle, readWrite) {
    const options = {};
    if (readWrite) {
        options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
        return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

async function saveToFileSystem() {
    if (!dirHandle) return;
    try {
        const hasPerm = await verifyPermission(dirHandle, true);
        if (!hasPerm) return;

        const fileHandle = await dirHandle.getFileHandle('timetracker_data.json', { create: true });
        const writable = await fileHandle.createWritable();
        const data = {
            logs: logs,
            activeShift: activeShift,
            lastSaved: new Date().toISOString()
        };
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    } catch (e) {
        console.error('File System Auto-save error:', e);
    }
}

async function loadFromFileSystem() {
    if (!dirHandle) return false;
    try {
        const hasPerm = await verifyPermission(dirHandle, false);
        if (!hasPerm) return false;

        const fileHandle = await dirHandle.getFileHandle('timetracker_data.json');
        const file = await fileHandle.getFile();
        const text = await file.text();
        if (!text) return false;
        
        const data = JSON.parse(text);
        if (data && Array.isArray(data.logs)) {
            logs = data.logs;
            activeShift = data.activeShift || null;
            // Also sync to LocalStorage fallback
            localStorage.setItem('multimango_logs', JSON.stringify(logs));
            if (activeShift) localStorage.setItem('multimango_active_shift', JSON.stringify(activeShift));
            else localStorage.removeItem('multimango_active_shift');
            return true;
        }
    } catch (e) {
        // File might not exist yet, which is normal on initial setup
    }
    return false;
}

// Firebase Config
let FIREBASE_DB_URL = 'https://multimango-tracker-default-rtdb.asia-southeast1.firebasedatabase.app/';
let FIREBASE_AUTH_KEY = 'MultimangoSecureKey_992182';

// Dynamic Database Overriding (for Phone Sync Access via QR)
const urlParams = new URLSearchParams(window.location.search);
const queryDb = urlParams.get('db');
const queryAuth = urlParams.get('auth');

if (queryDb && queryAuth) {
    localStorage.setItem('override_db_url', `https://${queryDb}.asia-southeast1.firebasedatabase.app/`);
    localStorage.setItem('override_auth_key', queryAuth);
    // Clean up URL query parameters to avoid bookmarking auth credentials
    window.history.replaceState({}, document.title, window.location.pathname);
}

const savedOverriddenUrl = localStorage.getItem('override_db_url');
const savedOverriddenAuth = localStorage.getItem('override_auth_key');
if (savedOverriddenUrl && savedOverriddenAuth) {
    FIREBASE_DB_URL = savedOverriddenUrl;
    FIREBASE_AUTH_KEY = savedOverriddenAuth;
}

// Save to LocalStorage & File System & Cloud Sync
function saveData() {
    localStorage.setItem('multimango_logs', JSON.stringify(logs));
    if (activeShift) {
        localStorage.setItem('multimango_active_shift', JSON.stringify(activeShift));
    } else {
        localStorage.removeItem('multimango_active_shift');
    }

    // Auto-save to local linked folder file
    saveToFileSystem();

    // Auto-sync to Firebase Cloud
    saveToCloud();
}

async function saveToCloud() {
    const statusEl = document.getElementById('cloud-sync-status');
    if (statusEl) {
        statusEl.innerHTML = '● Cloud: Syncing...';
        statusEl.style.color = 'var(--mango-primary)';
    }

    const url = `${FIREBASE_DB_URL}data.json?auth=${FIREBASE_AUTH_KEY}`;
    const payload = {
        logs: logs,
        payments: paymentEvents,
        activeShift: activeShift,
        lastSaved: new Date().toISOString()
    };

    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            if (statusEl) {
                statusEl.innerHTML = '● Cloud: Synced';
                statusEl.style.color = 'var(--success)';
            }
        } else {
            throw new Error('Cloud HTTP error ' + res.status);
        }
    } catch (e) {
        console.warn('Cloud auto-sync failed:', e);
        if (statusEl) {
            statusEl.innerHTML = '● Cloud: Offline';
            statusEl.style.color = 'var(--text-muted)';
        }
    }
}

async function fetchFromCloud() {
    const statusEl = document.getElementById('cloud-sync-status');
    if (statusEl) {
        statusEl.innerHTML = '● Cloud: Syncing...';
        statusEl.style.color = 'var(--mango-primary)';
    }

    const url = `${FIREBASE_DB_URL}data.json?auth=${FIREBASE_AUTH_KEY}`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            
            if (data === null) {
                // Cloud DB is valid but empty; if we have local logs, upload them to initialize cloud
                if (logs.length > 0 || activeShift) {
                    await saveToCloud();
                } else if (statusEl) {
                    statusEl.innerHTML = '● Cloud: Synced';
                    statusEl.style.color = 'var(--success)';
                }
                return true;
            }

            if (data && typeof data === 'object') {
                let hasChanges = false;
                if (data.logs && Array.isArray(data.logs)) {
                    // Smart Bidirectional Merging
                    const combinedLogs = [...logs, ...data.logs];
                    const cleanLogs = deduplicateLogs(combinedLogs);
                    if (JSON.stringify(logs) !== JSON.stringify(cleanLogs)) {
                        logs = cleanLogs;
                        localStorage.setItem('multimango_logs', JSON.stringify(logs));
                        hasChanges = true;
                    }
                }
                if (data.payments && Array.isArray(data.payments) && data.payments.length > 0) {
                    const combinedPayments = [...paymentEvents, ...data.payments];
                    const cleanPayments = deduplicatePaymentEvents(combinedPayments);
                    if (JSON.stringify(paymentEvents) !== JSON.stringify(cleanPayments)) {
                        paymentEvents = cleanPayments;
                        localStorage.setItem('multimango_payments', JSON.stringify(paymentEvents));
                        hasChanges = true;
                    }
                }
                // Cross-device activeShift sync
                const cloudActive = data && data.activeShift ? data.activeShift : null;
                let shouldForceNull = false;
                if (activeShift) {
                    const isSaved = logs.some(l => 
                        (activeShift.shiftId && l.shiftId === activeShift.shiftId) ||
                        (l.date === activeShift.date && l.startTime === activeShift.startTime && l.tasks === activeShift.tasks)
                    );
                    if (isSaved || cloudActive === null) {
                        shouldForceNull = true;
                    }
                }

                const targetActive = shouldForceNull ? null : cloudActive;
                if (JSON.stringify(activeShift) !== JSON.stringify(targetActive)) {
                    activeShift = targetActive;
                    if (activeShift) {
                        localStorage.setItem('multimango_active_shift', JSON.stringify(activeShift));
                    } else {
                        localStorage.removeItem('multimango_active_shift');
                    }
                    hasChanges = true;
                }

                if (hasChanges) {
                    renderLogs();
                    if (activeShift) {
                        resumeActiveShift();
                    } else {
                        updateUIForInactiveShift();
                    }
                }

                if (statusEl) {
                    statusEl.innerHTML = '● Cloud: Synced';
                    statusEl.style.color = 'var(--success)';
                }
                return true;
            }
        }
    } catch (e) {
        console.warn('Could not fetch from cloud:', e);
    }
    
    if (statusEl) {
        statusEl.innerHTML = '● Cloud: Offline';
        statusEl.style.color = 'var(--text-muted)';
    }
    return false;
}

function deduplicateLogs(logsArray) {
    if (!Array.isArray(logsArray)) return [];
    const seen = new Set();
    const result = [];
    for (const log of logsArray) {
        const key = log.shiftId || (log.id ? `id_${log.id}` : `${log.date}_${log.startTime}_${log.endTime}_${log.tasks}`);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(log);
        }
    }
    return result;
}

function deduplicatePaymentEvents(paymentsArray) {
    if (!Array.isArray(paymentsArray)) return [];
    const seen = new Set();
    const result = [];
    for (const p of paymentsArray) {
        const key = p.id || `${p.woKey}_${p.stage}_${p.date}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(p);
        }
    }
    return result;
}

// Load from LocalStorage (and attempt file system auto-sync)
async function loadData() {
    // Primary fallback: LocalStorage
    const savedLogs = localStorage.getItem('multimango_logs');
    if (savedLogs) {
        try {
            logs = deduplicateLogs(JSON.parse(savedLogs));
        } catch (e) {
            logs = [];
        }
    }
    
    const savedActive = localStorage.getItem('multimango_active_shift');
    if (savedActive) {
        try {
            activeShift = JSON.parse(savedActive);
        } catch (e) {
            activeShift = null;
        }
    }

    // Try pulling from cloud database
    await fetchFromCloud();

    // Attempt restoring file handle & load from synced local file
    try {
        const handle = await getStoredDirHandle();
        if (handle) {
            dirHandle = handle;
            updateSyncFolderUI();
            const loadedFromFile = await loadFromFileSystem();
            if (loadedFromFile) {
                renderLogs();
                if (activeShift) resumeActiveShift();
                else updateUIForInactiveShift();
            }
        }
    } catch (e) {
        console.warn('IDB handle restore error:', e);
    }
}

// Calculate decimal duration handling midnight crossing
function getDurationHours(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    const [sH, sM] = startStr.split(':').map(Number);
    const [eH, eM] = endStr.split(':').map(Number);
    
    let startMin = sH * 60 + sM;
    let endMin = eH * 60 + eM;
    
    if (endMin < startMin) {
        // Crossed midnight
        endMin += 24 * 60;
    }
    
    return (endMin - startMin) / 60;
}

// Format duration from decimal hours to string (e.g. 8h 15m)
function formatDurationText(decimalHours) {
    const totalMinutes = Math.round(decimalHours * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

// Format date into Indonesian locale readable
function formatLocalDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// --- EVENT LISTENERS ---
function initEventListeners() {
    // Folder Sync Button
    const btnSyncFolder = document.getElementById('btn-sync-folder');
    if (btnSyncFolder) {
        btnSyncFolder.addEventListener('click', selectSyncFolder);
    }

    // Shift Start/End buttons
    btnStartShift.addEventListener('click', startShift);
    btnEndShift.addEventListener('click', endShift);

    // Task Counter buttons
    if (btnPlusTask) btnPlusTask.addEventListener('click', incrementTask);
    if (btnMinusTask) btnMinusTask.addEventListener('click', decrementTask);

    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Filters
    if (filterStartDate) {
        filterStartDate.addEventListener('change', () => {
            const startVal = filterStartDate.value;
            if (startVal) {
                const startDate = new Date(startVal);
                // 7 days inclusive: StartDate + 6 days
                startDate.setDate(startDate.getDate() + 6);
                
                const year = startDate.getFullYear();
                const month = String(startDate.getMonth() + 1).padStart(2, '0');
                const day = String(startDate.getDate()).padStart(2, '0');
                if (filterEndDate) filterEndDate.value = `${year}-${month}-${day}`;
            }
            renderLogs();
        });
    }
    if (filterEndDate) filterEndDate.addEventListener('change', renderLogs);
    if (btnResetFilters) btnResetFilters.addEventListener('click', resetFilters);
    const btnClearFilters = document.getElementById('btn-clear-filters');
    if (btnClearFilters) {
        btnClearFilters.addEventListener('click', clearFilters);
    }

    // Export/Import
    const importFileInput = document.getElementById('import-file');
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportToCSV);
    if (btnExportJson) btnExportJson.addEventListener('click', exportToJSON);
    if (btnImportJson) btnImportJson.addEventListener('click', () => {
        if (importFileInput) importFileInput.click();
        else if (fileImportInput) fileImportInput.click();
    });
    if (importFileInput) importFileInput.addEventListener('change', importFromJSON);
    if (fileImportInput) fileImportInput.addEventListener('change', importFromJSON);

    // Modal Events
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeModal);
    if (btnSaveEdit) btnSaveEdit.addEventListener('click', saveEdit);

    // Set Now / Today Helper Buttons
    const btnDateToday = document.getElementById('btn-date-today');
    const btnStartNow = document.getElementById('btn-start-now');
    const btnEndNow = document.getElementById('btn-end-now');
    
    if (btnDateToday) {
        btnDateToday.addEventListener('click', () => {
            if (activeShift) {
                showToast('Cannot change date during active shift!', 'danger');
                return;
            }
            shiftDateInput.value = getTodayDateString();
            showToast('Shift date set to today.', 'success');
            checkDailyLimitWarning();
        });
    }

    if (btnStartNow) {
        btnStartNow.addEventListener('click', () => {
            if (activeShift) {
                showToast('Cannot change start time during active shift!', 'danger');
                return;
            }
            shiftStartInput.value = getCurrentTimeString();
            showToast('Start time set to current time.', 'success');
            checkDailyLimitWarning();
        });
    }

    if (btnEndNow) {
        btnEndNow.addEventListener('click', () => {
            shiftEndInput.value = getCurrentTimeString();
            showToast('End time set to current time.', 'success');
            checkDailyLimitWarning();
        });
    }

    // Attach shiftDateInput listener
    if (shiftDateInput) {
        shiftDateInput.addEventListener('change', checkDailyLimitWarning);
    }

    // Time Preset Buttons Helper
    const modifyStepperTime = (prefix, mins, isStartInput) => {
        if (isStartInput && activeShift) {
            showToast('Cannot change start time during active shift!', 'danger');
            return;
        }
        const currentTime = getStepperTime(prefix);
        const [h, m] = currentTime.split(':').map(Number);
        const tempDate = new Date();
        tempDate.setHours(h, m, 0, 0);
        tempDate.setMinutes(tempDate.getMinutes() + mins);
        const nh = String(tempDate.getHours()).padStart(2, '0');
        const nm = String(tempDate.getMinutes()).padStart(2, '0');
        
        if (isStartInput) {
            shiftStartInput.value = `${nh}:${nm}`;
        } else {
            shiftEndInput.value = `${nh}:${nm}`;
        }
        checkDailyLimitWarning();
    };

    // Start Time Presets (+ / -)
    const btnStartPlus15 = document.getElementById('btn-start-preset-plus15');
    const btnStartPlus30 = document.getElementById('btn-start-preset-plus30');
    const btnStartPlus1h = document.getElementById('btn-start-preset-plus1h');
    const btnStartMinus15 = document.getElementById('btn-start-preset-minus15');
    const btnStartMinus30 = document.getElementById('btn-start-preset-minus30');
    const btnStartMinus1h = document.getElementById('btn-start-preset-minus1h');

    if (btnStartPlus15) btnStartPlus15.addEventListener('click', () => modifyStepperTime('shift-start', 15, true));
    if (btnStartPlus30) btnStartPlus30.addEventListener('click', () => modifyStepperTime('shift-start', 30, true));
    if (btnStartPlus1h) btnStartPlus1h.addEventListener('click', () => modifyStepperTime('shift-start', 60, true));
    if (btnStartMinus15) btnStartMinus15.addEventListener('click', () => modifyStepperTime('shift-start', -15, true));
    if (btnStartMinus30) btnStartMinus30.addEventListener('click', () => modifyStepperTime('shift-start', -30, true));
    if (btnStartMinus1h) btnStartMinus1h.addEventListener('click', () => modifyStepperTime('shift-start', -60, true));

    // End Time Presets (+ / -)
    const btnPresetPlus15 = document.getElementById('btn-preset-plus15');
    const btnPresetPlus30 = document.getElementById('btn-preset-plus30');
    const btnPresetPlus1h = document.getElementById('btn-preset-plus1h');
    const btnPresetMinus15 = document.getElementById('btn-preset-minus15');
    const btnPresetMinus30 = document.getElementById('btn-preset-minus30');
    const btnPresetMinus1h = document.getElementById('btn-preset-minus1h');

    if (btnPresetPlus15) btnPresetPlus15.addEventListener('click', () => modifyStepperTime('shift-end', 15, false));
    if (btnPresetPlus30) btnPresetPlus30.addEventListener('click', () => modifyStepperTime('shift-end', 30, false));
    if (btnPresetPlus1h) btnPresetPlus1h.addEventListener('click', () => modifyStepperTime('shift-end', 60, false));
    if (btnPresetMinus15) btnPresetMinus15.addEventListener('click', () => modifyStepperTime('shift-end', -15, false));
    if (btnPresetMinus30) btnPresetMinus30.addEventListener('click', () => modifyStepperTime('shift-end', -30, false));
    if (btnPresetMinus1h) btnPresetMinus1h.addEventListener('click', () => modifyStepperTime('shift-end', -60, false));

    // Phone QR Sync Modal Events
    const btnSyncPhone = document.getElementById('btn-sync-phone');
    const qrModal = document.getElementById('qr-modal');
    const btnCloseQrModal = document.getElementById('btn-close-qr-modal');
    const qrcodeContainer = document.getElementById('qrcode-container');
    const qrLinkText = document.getElementById('qr-link-text');

    if (btnSyncPhone && qrModal) {
        btnSyncPhone.addEventListener('click', () => {
            qrcodeContainer.innerHTML = '';
            
            // Official Shionege GitHub Pages 24/7 Hosting Client
            const syncUrl = 'https://shionege.github.io/multimango-tracker/';
            
            if (qrLinkText) qrLinkText.textContent = syncUrl;

            // Generate QR Code
            new QRCode(qrcodeContainer, {
                text: syncUrl,
                width: 180,
                height: 180,
                colorDark: '#090d16',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });

            qrModal.classList.add('active');
        });
    }

    const btnCopyQrLink = document.getElementById('btn-copy-qr-link');
    if (btnCopyQrLink) {
        btnCopyQrLink.addEventListener('click', () => {
            const linkText = qrLinkText ? qrLinkText.textContent : '';
            if (linkText) {
                navigator.clipboard.writeText(linkText).then(() => {
                    showToast('Link copied to clipboard! Paste & open it in your phone browser.', 'success');
                }).catch(() => {
                    showToast('Could not copy link automatically.', 'danger');
                });
            }
        });
    }

    if (btnCloseQrModal && qrModal) {
        btnCloseQrModal.addEventListener('click', () => {
            qrModal.classList.remove('active');
        });
    }
}

// --- SHIFT LOGIC ---

function startShift() {
    const date = shiftDateInput.value;
    const start = shiftStartInput.value;

    if (!date || !start) {
        showToast('Please fill in Date and Start Time!', 'danger');
        return;
    }

    // Automatically set End Time to Start Time + 1 hour
    const [h, m] = start.split(':').map(Number);
    const endHour = (h + 1) % 24;
    const autoEndVal = `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setStepperTime('shift-end', autoEndVal);

    activeShift = {
        shiftId: 'shift_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        date: date,
        startTime: start,
        plannedEndTime: autoEndVal,
        tasks: 0,
        lastAddedTime: null,
        counterHistory: []
    };

    saveData();
    resumeActiveShift();
    showToast('Shift started! End Time set to Start Time + 1h.', 'success');
}

function resumeActiveShift() {
    // Update inputs to match active state
    shiftDateInput.value = activeShift.date;
    shiftStartInput.value = activeShift.startTime;
    shiftDateInput.disabled = true;
    shiftStartInput.disabled = true;
    shiftEndInput.disabled = false;
    
    if (activeShift.plannedEndTime) {
        setStepperTime('shift-end', activeShift.plannedEndTime);
    }
    // If no planned end time, leave the end stepper at whatever it shows — user can set it

    btnStartShift.disabled = true;
    btnStartShift.style.opacity = '0.5';
    btnStartShift.style.cursor = 'not-allowed';
    btnEndShift.disabled = false;
    btnEndShift.style.opacity = '1';
    btnEndShift.style.cursor = 'pointer';

    shiftStatusText.textContent = 'Shift Active';
    shiftStatusText.style.color = 'var(--accent-teal)';

    // Update Counter Display
    counterDisplay.textContent = activeShift.tasks;

    if (!activeShift.counterHistory) {
        activeShift.counterHistory = [];
    }
    renderCounterHistory();

    // Start Live Timer (Clean old interval if running)
    if (liveTimerInterval) clearInterval(liveTimerInterval);
    updateLiveTimer();
    liveTimerInterval = setInterval(updateLiveTimer, 1000);
}

function updateLiveTimer() {
    if (!activeShift) return;

    const now = new Date();

    // --- Elapsed duration: startTime → NOW ---
    const [sH, sM] = activeShift.startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(sH, sM, 0, 0);
    // Handle midnight crossing (shift started before midnight, now is after)
    if (startDate > now) startDate.setDate(startDate.getDate() - 1);

    const elapsedMs   = now - startDate;
    const totalSecs   = Math.floor(elapsedMs / 1000);
    const hrs  = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    shiftDurationTimer.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // --- Sisa Waktu / Overtime (only when user has set a planned end time) ---
    const timeLeftEl = document.getElementById('shift-time-left');
    if (!timeLeftEl) return;

    if (activeShift.plannedEndTime) {
        const [eH, eM] = activeShift.plannedEndTime.split(':').map(Number);
        const endDate = new Date();
        endDate.setHours(eH, eM, 0, 0);
        // If planned end is before shift start (crosses midnight), shift to next day
        if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

        const timeLeftMs = endDate - now;
        if (timeLeftMs > 0) {
            const tl = Math.floor(timeLeftMs / 1000);
            timeLeftEl.textContent = `Sisa Waktu: ${String(Math.floor(tl/3600)).padStart(2,'0')}:${String(Math.floor((tl%3600)/60)).padStart(2,'0')}:${String(tl%60).padStart(2,'0')}`;
            timeLeftEl.className = 'shift-time-left countdown';
            timeLeftEl.style.display = 'inline-block';
        } else {
            const ot = Math.floor(Math.abs(timeLeftMs) / 1000);
            timeLeftEl.textContent = `Overtime: ${String(Math.floor(ot/3600)).padStart(2,'0')}:${String(Math.floor((ot%3600)/60)).padStart(2,'0')}:${String(ot%60).padStart(2,'0')}`;
            timeLeftEl.className = 'shift-time-left overtime';
            timeLeftEl.style.display = 'inline-block';
        }
    } else {
        timeLeftEl.style.display = 'none';
    }
}


function updateUIForInactiveShift() {
    // Reset buttons
    btnStartShift.disabled = false;
    btnStartShift.style.opacity = '1';
    btnStartShift.style.cursor = 'pointer';
    btnEndShift.disabled = true;
    btnEndShift.style.opacity = '0.5';
    btnEndShift.style.cursor = 'not-allowed';

    shiftDateInput.disabled = false;
    shiftStartInput.disabled = false;
    shiftEndInput.disabled = false; // Allow configuring End Time pre-shift
    shiftEndInput.value = '00:00';

    shiftStatusText.textContent = 'Shift Inactive';
    shiftStatusText.style.color = 'var(--text-muted)';
    shiftDurationTimer.textContent = '00:00:00';
    
    const timeLeftEl = document.getElementById('shift-time-left');
    if (timeLeftEl) {
        timeLeftEl.style.display = 'none';
        timeLeftEl.textContent = 'Sisa Waktu: 00:00:00';
    }

    counterDisplay.textContent = '0';
    if (counterAuditLog) {
        counterAuditLog.innerHTML = '<div class="audit-empty">No active shift.</div>';
    }

    // Clear intervals
    if (liveTimerInterval) clearInterval(liveTimerInterval);
}

function endShift() {
    if (!activeShift) return;

    const currentShiftId = activeShift.shiftId;
    
    // Check if this shift has already been saved to logs (e.g. ended on another device)
    const alreadySaved = logs.some(l => 
        (currentShiftId && l.shiftId === currentShiftId) ||
        (l.date === activeShift.date && l.startTime === activeShift.startTime && l.tasks === activeShift.tasks)
    );

    if (alreadySaved) {
        activeShift = null;
        saveData();
        updateUIForInactiveShift();
        renderLogs();
        showToast('Shift was already ended and synced from another device.', 'info');
        return;
    }

    const end = shiftEndInput.value;

    const duration = getDurationHours(activeShift.startTime, end);
    if (duration <= 0) {
        showToast('End Time must be later than Start Time!', 'danger');
        return;
    }

    const newLog = {
        id: Date.now().toString(),
        shiftId: currentShiftId || ('shift_' + Date.now()),
        date: activeShift.date,
        startTime: activeShift.startTime,
        endTime: end,
        duration: duration,
        tasks: activeShift.tasks,
        rate: duration > 0 ? Number((activeShift.tasks / duration).toFixed(2)) : 0
    };

    logs.unshift(newLog); // add to top of array
    activeShift = null;

    saveData();
    updateUIForInactiveShift();
    renderLogs();
    
    showToast(`Shift saved successfully! ${newLog.tasks} tasks completed.`, 'success');
}

// --- TASK COUNTER LOGIC ---

function incrementTask() {
    if (!activeShift) {
        showToast('Please Start Shift first to count tasks!', 'danger');
        return;
    }

    activeShift.tasks += 1;
    activeShift.lastAddedTime = Date.now();
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    if (!activeShift.counterHistory) activeShift.counterHistory = [];
    activeShift.counterHistory.unshift({
        time: timeStr,
        action: '+1',
        total: activeShift.tasks
    });
    
    saveData();

    // Trigger visual pop animation
    counterDisplay.textContent = activeShift.tasks;
    counterDisplay.classList.remove('increment-pop');
    void counterDisplay.offsetWidth; // Trigger reflow
    counterDisplay.classList.add('increment-pop');

    renderCounterHistory();
}

function decrementTask() {
    if (!activeShift) {
        showToast('Please Start Shift first to count tasks!', 'danger');
        return;
    }

    if (activeShift.tasks <= 0) return;

    activeShift.tasks -= 1;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    if (!activeShift.counterHistory) activeShift.counterHistory = [];
    activeShift.counterHistory.unshift({
        time: timeStr,
        action: '-1',
        total: activeShift.tasks
    });
    
    saveData();

    counterDisplay.textContent = activeShift.tasks;
    renderCounterHistory();
}

function renderCounterHistory() {
    if (!counterAuditLog) return;
    
    if (!activeShift || !activeShift.counterHistory || activeShift.counterHistory.length === 0) {
        counterAuditLog.innerHTML = '<div class="audit-empty">No activity logged yet.</div>';
        return;
    }
    
    counterAuditLog.innerHTML = activeShift.counterHistory.map(item => `
        <div class="audit-item">
            <span class="audit-time">${item.time}</span>
            <span class="audit-action ${item.action.startsWith('+') ? 'plus' : 'minus'}">${item.action}</span>
            <span class="audit-total">Total: ${item.total}</span>
        </div>
    `).join('');
}

// Keyboard shortcuts mapping
function handleKeyboardShortcuts(e) {
    // If user is typing in an input field, do not trigger shortcuts
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space' || e.key === '+' || e.key === 'ArrowUp') {
        e.preventDefault();
        incrementTask();
    } else if (e.key === '-' || e.key === 'ArrowDown') {
        e.preventDefault();
        decrementTask();
    }
}

// --- LOG RENDERING & STATS ---

// Track open daily detail rows
const expandedDates = new Set();

function toggleDailyDetail(dateStr) {
    if (expandedDates.has(dateStr)) {
        expandedDates.delete(dateStr);
    } else {
        expandedDates.add(dateStr);
    }
    renderLogs();
}

function renderLogs() {
    const startFilter = filterStartDate.value;
    const endFilter = filterEndDate.value;

    let filtered = logs;

    if (startFilter) {
        filtered = filtered.filter(log => log.date >= startFilter);
    }
    if (endFilter) {
        filtered = filtered.filter(log => log.date <= endFilter);
    }

    logsTbody.innerHTML = '';

    if (filtered.length === 0) {
        emptyState.style.display = 'flex';
    } else {
        emptyState.style.display = 'none';

        // Group filtered logs by Date (YYYY-MM-DD)
        const groups = {};
        filtered.forEach(log => {
            if (!groups[log.date]) {
                groups[log.date] = [];
            }
            groups[log.date].push(log);
        });

        // Sort dates descending (newest first)
        const sortedDates = Object.keys(groups).sort().reverse();

        sortedDates.forEach(dateStr => {
            const shiftList = groups[dateStr];
            // Sort shifts chronologically by startTime ascending (earliest first)
            shiftList.sort((a, b) => a.startTime.localeCompare(b.startTime));

            let dayTasks = 0;
            let dayHours = 0;

            shiftList.forEach(item => {
                dayTasks += item.tasks;
                dayHours += item.duration;
            });

            const dayRate = dayHours > 0 ? (dayTasks / dayHours).toFixed(2) : '0.00';
            
            // Limit paid hours to 10 hours daily max
            const dayHoursPaid = Math.min(10, dayHours);
            const dayPaymentUsd = dayHoursPaid * 5;
            const isCapped = dayHours > 10;
            
            const isExpanded = expandedDates.has(dateStr);

            // 1. Cumulative Summary Row (8 Columns)
            const mainTr = document.createElement('tr');
            mainTr.className = `daily-summary-row ${isExpanded ? 'expanded' : ''}`;
            mainTr.onclick = () => toggleDailyDetail(dateStr);
            mainTr.title = "Click to expand/collapse shift details";

            mainTr.innerHTML = `
                <td class="col-expand"><span class="expand-icon">${isExpanded ? '▼' : '▶'}</span></td>
                <td class="col-date"><strong>${formatLocalDate(dateStr)}</strong></td>
                <td class="col-shifts"><span class="badge badge-mango">${shiftList.length} shift${shiftList.length > 1 ? 's' : ''}</span></td>
                <td class="col-duration">${dayHours.toFixed(2)}h</td>
                <td class="col-tasks"><strong>${dayTasks}</strong></td>
                <td class="col-rate">${dayRate}/hr</td>
                <td class="col-payment">
                    <strong style="color: ${isCapped ? 'var(--mango-primary)' : 'var(--accent-teal)'};">
                        ${formatPaymentIDR(dayPaymentUsd)}
                    </strong>
                    <span style="font-size: 0.72rem; color: var(--text-muted); display: block; margin-top: 0.1rem;">$${dayPaymentUsd.toFixed(2)}</span>
                    ${isCapped ? '<span style="font-size: 0.65rem; color: var(--mango-primary); display:block; font-weight:normal; margin-top: 0.15rem;">Capped (10h)</span>' : ''}
                </td>
                <td class="col-action"></td>
            `;
            logsTbody.appendChild(mainTr);

            // 2. Expandable Shift Detail Sub-Rows (8 Columns)
            if (isExpanded) {
                shiftList.forEach((log, sIndex) => {
                    const globalIndex = logs.findIndex(item => item.id === log.id);
                    const shiftPaymentUsd = log.duration * 5;
                    const subTr = document.createElement('tr');
                    subTr.className = 'daily-detail-row';
                    subTr.innerHTML = `
                        <td class="col-expand"></td>
                        <td class="col-date" style="padding-left: 1.25rem; font-size: 0.8rem; color: var(--text-muted);">
                            <span style="opacity: 0.5;">└</span> Shift #${sIndex + 1}
                        </td>
                        <td class="col-shifts"><span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid var(--card-border);">${log.startTime} - ${log.endTime}</span></td>
                        <td class="col-duration">${log.duration.toFixed(2)}h</td>
                        <td class="col-tasks">${log.tasks}</td>
                        <td class="col-rate">${log.rate.toFixed(2)}/hr</td>
                        <td class="col-payment" style="color: var(--text-muted);">
                            <span>${formatPaymentIDR(shiftPaymentUsd)}</span>
                            <span style="font-size: 0.72rem; color: var(--text-dimmed); display: block; margin-top: 0.1rem;">$${shiftPaymentUsd.toFixed(2)}</span>
                        </td>
                        <td class="col-action" onclick="event.stopPropagation();">
                            <div class="action-buttons">
                                <button class="btn-action" onclick="openEditModal(${globalIndex})" title="Edit Log">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                                </button>
                                <button class="btn-action btn-action-delete" onclick="deleteLog('${log.id}')" title="Delete Log">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                </button>
                            </div>
                        </td>
                    `;
                    logsTbody.appendChild(subTr);
                });
            }
        });
    }

    calculateStats(filtered);
}

function calculateStats(filteredList) {
    let totalTasks = 0;
    let totalHours = 0;
    
    // Calculate total hours paid with 10 hours daily cap applied
    const dailyHoursMap = {};
    filteredList.forEach(log => {
        totalTasks += log.tasks;
        totalHours += log.duration;
        
        // Group hours by date to apply cap
        if (!dailyHoursMap[log.date]) {
            dailyHoursMap[log.date] = 0;
        }
        dailyHoursMap[log.date] += log.duration;
    });

    let totalHoursPaid = 0;
    Object.keys(dailyHoursMap).forEach(date => {
        totalHoursPaid += Math.min(10, dailyHoursMap[date]);
    });

    const averageRate = totalHours > 0 ? (totalTasks / totalHours).toFixed(2) : '0.00';
    const totalPaymentUsd = totalHoursPaid * 5;

    statTotalTasks.textContent = totalTasks;
    statTotalHours.textContent = `${totalHours.toFixed(2)} hrs (${formatDurationText(totalHours)})`;
    statAvgRate.textContent = `${averageRate} tasks/hr`;
    
    const statTotalPayment = document.getElementById('stat-total-payment');
    if (statTotalPayment) {
        statTotalPayment.innerHTML = `
            ${formatPaymentIDR(totalPaymentUsd)}
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 500; margin-top: 0.2rem;">($${totalPaymentUsd.toFixed(2)})</div>
        `;
    }
}

function resetFilters() {
    const todayStr = getTodayDateString();
    filterStartDate.value = todayStr;
    filterEndDate.value = todayStr;
    renderLogs();
    showToast('Filters reset to Today', 'info');
}

function clearFilters() {
    filterStartDate.value = '';
    filterEndDate.value = '';
    renderLogs();
    showToast('Showing all historical logs', 'info');
}

// --- DELETE LOG ---
window.deleteLog = function(id) {
    if (confirm('Are you sure you want to delete this shift report?')) {
        logs = logs.filter(log => log.id !== id);
        saveData();
        renderLogs();
        showToast('Shift report deleted', 'success');
    }
};

// --- EDIT MODAL LOGIC ---
window.openEditModal = function(index) {
    const log = logs[index];
    editIndexInput.value = index;
    editDateInput.value = log.date;
    editStartInput.value = log.startTime;
    editEndInput.value = log.endTime;
    editTasksInput.value = log.tasks;
    
    editModal.classList.add('active');
};

function closeModal() {
    editModal.classList.remove('active');
}

function saveEdit() {
    const index = parseInt(editIndexInput.value);
    const date = editDateInput.value;
    const start = editStartInput.value;
    const end = editEndInput.value;
    const tasks = parseInt(editTasksInput.value);

    if (!date || !start || !end || isNaN(tasks) || tasks < 0) {
        showToast('Please fill in all details correctly!', 'danger');
        return;
    }

    const duration = getDurationHours(start, end);
    if (duration <= 0) {
        showToast('End Time must be later than Start Time!', 'danger');
        return;
    }

    logs[index].date = date;
    logs[index].startTime = start;
    logs[index].endTime = end;
    logs[index].tasks = tasks;
    logs[index].duration = duration;
    logs[index].rate = duration > 0 ? Number((tasks / duration).toFixed(2)) : 0;

    saveData();
    closeModal();
    renderLogs();
    showToast('Shift report updated successfully', 'success');
}

// --- CSV & JSON PORTABILITY ---

function exportToCSV() {
    if (logs.length === 0) {
        showToast('No shift logs to export!', 'danger');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Start Time,End Time,Duration (Hrs),Tasks Completed,Rate (Tasks/Hr)\r\n";

    logs.forEach(log => {
        csvContent += `${log.date},${log.startTime},${log.endTime},${log.duration.toFixed(2)},${log.tasks},${log.rate.toFixed(2)}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `multimango_shift_report_${getTodayDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('CSV report downloaded!', 'success');
}

function exportToJSON() {
    if (logs.length === 0) {
        showToast('No shift logs to backup!', 'danger');
        return;
    }

    const jsonStr = JSON.stringify(logs, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `multimango_backup_${getTodayDateString()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Backup JSON file downloaded!', 'success');
}

function importFromJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const importedLogs = JSON.parse(evt.target.result);
            if (!Array.isArray(importedLogs)) {
                throw new Error("Invalid file content format (must be JSON array)");
            }
            
            // Basic schema check
            const isValid = importedLogs.every(item => item.date && item.startTime && item.endTime && item.id);
            if (!isValid) {
                throw new Error("Invalid backup schema structure!");
            }

            if (confirm(`Do you want to merge ${importedLogs.length} logs with your existing logs? (Matching IDs will be updated)`)) {
                // Merge logs
                const existingMap = new Map(logs.map(item => [item.id, item]));
                importedLogs.forEach(item => {
                    existingMap.set(item.id, item);
                });
                logs = Array.from(existingMap.values());
                // Sort descending by id (timestamp) or date
                logs.sort((a, b) => b.id.localeCompare(a.id));
                
                saveData();
                renderLogs();
                showToast('Database imported and merged successfully!', 'success');
            }
        } catch (error) {
            showToast(`Import failed: ${error.message}`, 'danger');
        }
        // Reset file input value
        fileImportInput.value = '';
    };
    reader.readAsText(file);
}

// --- PAYMENT CALENDAR & GMAIL AUTO-SYNC MODULE ---
const DEFAULT_PAYMENT_EVENTS = [
    // Work Order 1 ($91.25 - Z3426188112)
    {
        id: 'wo_Z3426188112',
        woKey: 'Z3426188112',
        date: '2026-07-27',
        stage: 'wo_created',
        title: 'Work Order Created (Z3426188112)',
        amount: 91.25,
        statusText: '🔵 Work Order Created (Z3426188112)',
        details: 'Document No: Z3426188112 | Period: 07/18/2026 to 07/24/2026 | Amount: $91.25'
    },
    {
        id: 'sub_Z3426188112',
        woKey: 'Z3426188112',
        date: '2026-08-04',
        stage: 'tipalti_submitted',
        title: 'Tipalti Submitted ($91.25)',
        amount: 91.25,
        statusText: '🟡 Tipalti Submitted (Z3426188112)',
        details: 'Submitted to Tipalti | Amount: $91.25'
    },
    {
        id: 'clr_PTIP1402590Z2426',
        woKey: 'Z3426188112',
        date: '2026-08-05',
        stage: 'cleared',
        title: 'Payment Cleared (PTIP1402590Z2426)',
        amount: 91.25,
        amountIdr: 'Rp 1.583.237,00',
        statusText: '🟢 Payment Cleared to Bank ($91.25 / Rp 1.583.237,00)',
        details: 'Doc Ref: PTIP1402590Z2426 | USD $91.25 -> IDR Rp 1.583.237,00'
    },

    // Work Order 2 ($90.85 - Z3426186860)
    {
        id: 'wo_Z3426186860',
        woKey: 'Z3426186860',
        date: '2026-07-27',
        stage: 'wo_created',
        title: 'Work Order Created (Z3426186860)',
        amount: 90.85,
        statusText: '🔵 Work Order Created (Z3426186860)',
        details: 'Document No: Z3426186860 | Amount: $90.85'
    },
    {
        id: 'sub_Z3426186860',
        woKey: 'Z3426186860',
        date: '2026-08-04',
        stage: 'tipalti_submitted',
        title: 'Tipalti Submitted ($90.85)',
        amount: 90.85,
        statusText: '🟡 Tipalti Submitted (Z3426186860)',
        details: 'Submitted to Tipalti | Amount: $90.85'
    },
    {
        id: 'clr_Z3426186860',
        woKey: 'Z3426186860',
        date: '2026-07-29',
        stage: 'cleared',
        title: 'Payment Cleared ($90.85)',
        amount: 90.85,
        statusText: '🟢 Payment Cleared ($90.85)',
        details: 'Document No: Z3426186860 | Amount: $90.85'
    }
];

let paymentEvents = [...DEFAULT_PAYMENT_EVENTS];
let calendarCurrentDate = new Date();
const GOOGLE_CLIENT_ID = '848704186375-qcg8qv6rugiaud1fqan4raoi8nb5s2uf.apps.googleusercontent.com';
let tokenClient = null;

function initPaymentCalendar() {
    const savedPayments = localStorage.getItem('multimango_payments');
    if (savedPayments) {
        try {
            const parsed = JSON.parse(savedPayments);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Filter out any stale $10 test entries and duplicate Jul 29 $91.25 entry
                const cleanParsed = parsed.filter(p => p.id !== 'clr_Jul29_9125' && p.amount && p.amount !== 10 && p.amount > 20);
                paymentEvents = deduplicatePaymentEvents([...DEFAULT_PAYMENT_EVENTS, ...cleanParsed]);
            }
        } catch(e) {}
    }
    // Filter paymentEvents to ensure no clr_Jul29_9125 duplicate exists
    paymentEvents = paymentEvents.filter(p => p.id !== 'clr_Jul29_9125' && p.amount && p.amount !== 10 && p.amount > 20);
    localStorage.setItem('multimango_payments', JSON.stringify(paymentEvents));

    const tabShift = document.getElementById('tab-shift-tracker');
    const tabPay = document.getElementById('tab-payment-calendar');
    const viewShift = document.getElementById('view-shift-tracker');
    const viewPay = document.getElementById('view-payment-calendar');

    if (tabShift && tabPay && viewShift && viewPay) {
        tabShift.addEventListener('click', () => {
            tabShift.classList.add('active');
            tabPay.classList.remove('active');
            viewShift.classList.add('active');
            viewPay.classList.remove('active');
        });
        tabPay.addEventListener('click', () => {
            tabPay.classList.add('active');
            tabShift.classList.remove('active');
            viewPay.classList.add('active');
            viewShift.classList.remove('active');
            renderPaymentCalendar();
        });
    }

    const btnPrev = document.getElementById('btn-cal-prev-month');
    const btnNext = document.getElementById('btn-cal-next-month');
    if (btnPrev) btnPrev.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
        renderPaymentCalendar();
    });
    if (btnNext) btnNext.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
        renderPaymentCalendar();
    });

    const btnClosePayModal = document.getElementById('btn-close-pay-modal');
    if (btnClosePayModal) {
        btnClosePayModal.addEventListener('click', () => {
            document.getElementById('payment-modal').classList.remove('active');
        });
    }

    // GIS Google OAuth Client setup
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            callback: async (response) => {
                if (response.access_token) {
                    localStorage.setItem('gmail_token', response.access_token);
                    await fetchGmailPayments(response.access_token);
                }
            }
        });
    }

    const btnConnectGmail = document.getElementById('btn-connect-gmail');
    if (btnConnectGmail) {
        btnConnectGmail.addEventListener('click', () => {
            if (!tokenClient && window.google && window.google.accounts && window.google.accounts.oauth2) {
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/gmail.readonly',
                    callback: async (response) => {
                        if (response.access_token) {
                            localStorage.setItem('gmail_token', response.access_token);
                            await fetchGmailPayments(response.access_token);
                        }
                    }
                });
            }
            if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: 'select_account' });
            } else {
                showToast('Google GIS library loading... try again in a moment.', 'info');
            }
        });
    }

    // Auto-load saved Gmail token if present
    const savedGmailToken = localStorage.getItem('gmail_token');
    if (savedGmailToken) {
        fetchGmailPayments(savedGmailToken).catch(() => {});
    }

    renderPaymentCalendar();
}

async function fetchGmailPayments(accessToken) {
    const badge = document.getElementById('gmail-sync-status');
    const btnText = document.getElementById('gmail-btn-text');
    if (badge) { badge.textContent = '● Gmail: Syncing...'; badge.style.color = 'var(--mango-primary)'; }

    try {
        const query = 'from:(no-reply@rws.com OR notifications@tipalti.com) (Work Order OR payment OR cleared)';
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!listRes.ok) throw new Error('Failed to fetch Gmail messages');
        const listData = await listRes.json();

        if (listData.messages && listData.messages.length > 0) {
            for (const msgRef of listData.messages) {
                const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                if (msgRes.ok) {
                    const msg = await msgRes.json();
                    parseGmailMessage(msg);
                }
            }
        }

        if (badge) { badge.textContent = '● Gmail: Synced'; badge.style.color = '#34d399'; }
        if (btnText) btnText.textContent = 'Re-Sync Gmail';
        renderPaymentCalendar();
    } catch (e) {
        if (badge) { badge.textContent = '● Gmail: Error/Expired'; badge.style.color = 'var(--danger)'; }
    }
}

function extractBodyFromGmailMsg(msg) {
    if (!msg || !msg.payload) return msg.snippet || '';
    let body = msg.snippet || '';
    
    function decodePart(part) {
        if (part.body && part.body.data) {
            try {
                const b64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
                const decoded = decodeURIComponent(escape(window.atob(b64)));
                body += ' ' + decoded;
            } catch(e) {}
        }
        if (part.parts && Array.isArray(part.parts)) {
            part.parts.forEach(decodePart);
        }
    }

    decodePart(msg.payload);
    return body;
}

function parseGmailMessage(msg) {
    const fullText = extractBodyFromGmailMsg(msg);
    const internalDate = parseInt(msg.internalDate) || Date.now();
    const dateStr = new Date(internalDate).toISOString().split('T')[0];

    // Stage 1: RWS Work Order Created (Extracted directly from HTML/Text body)
    if (fullText.includes('Work Order') || fullText.includes('Z342') || fullText.includes('Document No.')) {
        const docMatch = fullText.match(/Z\d{9,}/) || fullText.match(/Document No\.\s*[:\s]*\(?([A-Z0-9]+)\)?/i);
        const amountMatch = fullText.match(/(?:Total Amount|Total USD|Amount|USD)\s*[:\s]*\$?\s*([\d\.]+)/i) || fullText.match(/\$\s*([\d\.]+)/);
        
        if (docMatch || amountMatch) {
            const woKey = docMatch ? (docMatch[1] || docMatch[0]) : `wo_${dateStr}`;
            const amount = amountMatch ? parseFloat(amountMatch[1]) : 91.25;

            if (amount > 0 && amount !== 10) {
                upsertPaymentEvent({
                    id: woKey,
                    woKey: woKey,
                    date: dateStr,
                    stage: 'wo_created',
                    title: `Work Order Created (${woKey})`,
                    amount: amount,
                    statusText: `🔵 Work Order Created (${woKey})`,
                    details: `Document No: ${woKey} | Amount: $${amount.toFixed(2)}`
                });
            }
        }
    }

    // Stage 2 & 3: Tipalti Submitted / Cleared
    if (fullText.includes('Tipalti') || fullText.includes('payment') || fullText.includes('cleared')) {
        const amountMatch = fullText.match(/(?:Total Amount|Total USD|Amount|USD)\s*[:\s]*\$?\s*([\d\.]+)/i) || fullText.match(/\$\s*([\d\.]+)/);
        const idrMatch = fullText.match(/Rp\s*([\d\.,]+)/i);
        const isCleared = fullText.includes('cleared') || fullText.includes('processed') || fullText.includes('paid');
        const amount = amountMatch ? parseFloat(amountMatch[1]) : 91.25;

        if (amount > 0 && amount !== 10) {
            // $91.25 was cleared on August 5, NOT July. Prevent erroneous $91.25 cleared events in July.
            if (isCleared && amount > 91 && dateStr < '2026-08-01') {
                return;
            }

            upsertPaymentEvent({
                id: isCleared ? (amount > 91 ? 'clr_PTIP1402590Z2426' : 'clr_Z3426186860') : `tipalti_${dateStr}_${amount.toFixed(2)}`,
                woKey: amount > 91 ? 'Z3426188112' : 'Z3426186860',
                date: isCleared ? (amount > 91 ? '2026-08-05' : '2026-07-29') : dateStr,
                stage: isCleared ? 'cleared' : 'tipalti_submitted',
                title: isCleared ? 'Payment Cleared' : 'Tipalti Submitted',
                amount: amount,
                amountIdr: idrMatch ? idrMatch[0] : 'Rp 1.583.237,00',
                statusText: isCleared ? '🟢 Payment Cleared (Bank)' : '🟡 Tipalti Submitted',
                details: isCleared ? `USD: $${amount.toFixed(2)} | IDR: ${idrMatch ? idrMatch[0] : 'Rp 1.583.237,00'}` : 'Submitted to Tipalti'
            });
        }
    }
}

function upsertPaymentEvent(evt) {
    // Prevent adding any $91.25 cleared event in July 2026
    if (evt.stage === 'cleared' && evt.amount > 91 && evt.date < '2026-08-01') {
        return;
    }
    const idx = paymentEvents.findIndex(p => p.id === evt.id || (p.woKey && p.woKey === evt.woKey && p.stage === evt.stage));
    if (idx >= 0) {
        paymentEvents[idx] = { ...paymentEvents[idx], ...evt };
    } else {
        paymentEvents.push(evt);
    }
    // Filter out invalid $91.25 July cleared entries
    paymentEvents = paymentEvents.filter(p => !(p.stage === 'cleared' && p.amount > 91 && p.date < '2026-08-01'));
    localStorage.setItem('multimango_payments', JSON.stringify(paymentEvents));
}

function getCleanDeduplicatedPayments() {
    const seen = new Set();
    const result = [];

    paymentEvents.forEach(evt => {
        // Block any invalid $91.25 cleared event in July
        if (evt.stage === 'cleared' && evt.amount > 91 && evt.date < '2026-08-01') {
            return;
        }
        const uniqueKey = evt.id || `${evt.woKey}_${evt.stage}_${evt.date}`;
        if (!seen.has(uniqueKey)) {
            seen.add(uniqueKey);
            result.push(evt);
        }
    });

    return result;
}

function renderPaymentCalendar() {
    const grid = document.getElementById('calendar-grid');
    const title = document.getElementById('cal-month-year-title');
    if (!grid || !title) return;

    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    title.textContent = `${monthNames[month]} ${year}`;

    grid.innerHTML = '';
    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-based
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    // Padding empty cells
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day-cell empty';
        grid.appendChild(emptyCell);
    }

    const cleanPayments = getCleanDeduplicatedPayments();

    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'cal-day-cell' + (dayStr === todayStr ? ' today' : '');

        const numEl = document.createElement('div');
        numEl.className = 'cal-day-num';
        numEl.textContent = day;
        cell.appendChild(numEl);

        const events = cleanPayments.filter(p => p.date === dayStr);
        events.forEach(evt => {
            const badge = document.createElement('div');
            badge.className = `cal-event-badge stage-${evt.stage === 'wo_created' ? 'wo' : evt.stage === 'cleared' ? 'cleared' : 'submitted'}`;
            const labelText = evt.woKey ? evt.woKey : (evt.stage === 'cleared' ? 'Cleared' : evt.stage === 'tipalti_submitted' ? 'Tipalti Proc' : 'WO Created');
            badge.textContent = `${labelText} ($${evt.amount.toFixed(2)})`;
            badge.addEventListener('click', () => openPaymentEventModal(evt));
            cell.appendChild(badge);
        });

        grid.appendChild(cell);
    }

    updatePaymentSummaryWidgets();
}

function updatePaymentSummaryWidgets() {
    const woVal = document.getElementById('pay-sum-wo-created');
    const woCnt = document.getElementById('pay-sum-wo-count');
    const procVal = document.getElementById('pay-sum-tipalti-proc');
    const procCnt = document.getElementById('pay-sum-proc-count');
    const clearedUsd = document.getElementById('pay-sum-cleared-usd');
    const clearedIdr = document.getElementById('pay-sum-cleared-idr');

    const cleanPayments = getCleanDeduplicatedPayments();

    // 1. Determine current max stage reached per Work Order
    const woStatusMap = new Map();
    cleanPayments.forEach(p => {
        const key = p.woKey || `amt_${(p.amount || 0).toFixed(2)}`;
        if (!woStatusMap.has(key)) {
            woStatusMap.set(key, { amount: p.amount, maxStage: p.stage });
        } else {
            const entry = woStatusMap.get(key);
            if (p.stage === 'cleared') {
                entry.maxStage = 'cleared';
            } else if (p.stage === 'tipalti_submitted' && entry.maxStage !== 'cleared') {
                entry.maxStage = 'tipalti_submitted';
            }
        }
    });

    // 2. Aggregate Pending WO and Processing in Tipalti
    let pendingWoTotal = 0;
    let pendingWoCount = 0;
    let procTipaltiTotal = 0;
    let procTipaltiCount = 0;

    woStatusMap.forEach(entry => {
        if (entry.maxStage === 'wo_created') {
            pendingWoTotal += entry.amount;
            pendingWoCount++;
        } else if (entry.maxStage === 'tipalti_submitted') {
            procTipaltiTotal += entry.amount;
            procTipaltiCount++;
        }
    });

    // 3. Filter Cleared events strictly for currently viewed calendar month & year
    const targetYear = calendarCurrentDate.getFullYear();
    const targetMonth = calendarCurrentDate.getMonth();

    const clearedThisMonth = cleanPayments.filter(p => {
        if (p.stage !== 'cleared') return false;
        const d = new Date(p.date);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
    });

    const totalClearedUsd = clearedThisMonth.reduce((s, e) => s + e.amount, 0);

    let totalClearedIdrStr = 'Rp 0';
    if (clearedThisMonth.length > 0) {
        if (clearedThisMonth.length === 1 && clearedThisMonth[0].amountIdr) {
            totalClearedIdrStr = clearedThisMonth[0].amountIdr;
        } else {
            totalClearedIdrStr = formatPaymentIDR(totalClearedUsd);
        }
    }

    if (woVal) woVal.textContent = `$${pendingWoTotal.toFixed(2)}`;
    if (woCnt) woCnt.textContent = `${pendingWoCount} Work Orders`;
    if (procVal) procVal.textContent = `$${procTipaltiTotal.toFixed(2)}`;
    if (procCnt) procCnt.textContent = `${procTipaltiCount} Payments`;
    if (clearedUsd) clearedUsd.textContent = `$${totalClearedUsd.toFixed(2)}`;
    if (clearedIdr) clearedIdr.textContent = totalClearedIdrStr;
}

function openPaymentEventModal(evt) {
    const modal = document.getElementById('payment-modal');
    const title = document.getElementById('pay-modal-title');
    const body = document.getElementById('pay-modal-body');
    if (!modal || !body) return;

    if (title) title.textContent = evt.title || 'Payment Event Detail';
    body.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 1rem; border-radius: 12px; display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">Status: <strong>${evt.statusText}</strong></div>
            <div style="font-size: 1.4rem; font-weight: 800; color: #34d399;">$${evt.amount.toFixed(2)}</div>
            ${evt.amountIdr ? `<div style="font-size: 1rem; font-weight: 700; color: #10b981;">${evt.amountIdr}</div>` : ''}
            <div style="font-size: 0.8rem; color: var(--text-dimmed); margin-top: 0.5rem;">${evt.details || ''}</div>
        </div>
    `;
    modal.classList.add('active');
}

// Auto initialize Payment Calendar module on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initPaymentCalendar();
});
