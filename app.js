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
const btnPlusTask = document.getElementById('btn-increment') || document.getElementById('btn-plus-task');
const btnMinusTask = document.getElementById('btn-undo-task') || document.getElementById('btn-minus-task');
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

const logsTbody = document.getElementById('logs-tbody') || document.getElementById('history-table-body');
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
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data && data.rates && data.rates.IDR) {
            usdToIdrRate = data.rates.IDR;
            const formatted = new Intl.NumberFormat('id-ID').format(Math.round(usdToIdrRate));
            const el = document.getElementById('rate-exchange-info');
            if (el) el.textContent = `Rate: $1 = Rp ${formatted}`;
            
            // Re-render logs and stats with the updated live rate
            renderLogs();
        }
    } catch (e) {
        console.warn('Failed to fetch live USD/IDR rate, using fallback', e);
        const el = document.getElementById('rate-exchange-info');
        if (el) el.textContent = `Rate: $1 = Rp 16.000 (fallback)`;
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
    localStorage.setItem('multimango_payments', JSON.stringify(paymentEvents));
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
        activeShift: activeShift,
        payments: paymentEvents,
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
                if (logs.length > 0 || activeShift || paymentEvents.length > 0) {
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
                    // Smart Bidirectional Merging: Combine local logs + cloud logs so no entries are lost
                    const combinedLogs = [...logs, ...data.logs];
                    const cleanLogs = deduplicateLogs(combinedLogs);
                    if (JSON.stringify(logs) !== JSON.stringify(cleanLogs)) {
                        logs = cleanLogs;
                        localStorage.setItem('multimango_logs', JSON.stringify(logs));
                        hasChanges = true;
                    }
                }
                if (data.payments && Array.isArray(data.payments)) {
                    // Smart Bidirectional Merging for Payment Events
                    const combinedPayments = [...paymentEvents, ...data.payments];
                    const cleanPayments = deduplicatePaymentEvents(combinedPayments);
                    if (JSON.stringify(paymentEvents) !== JSON.stringify(cleanPayments)) {
                        paymentEvents = cleanPayments;
                        localStorage.setItem('multimango_payments', JSON.stringify(paymentEvents));
                        hasChanges = true;
                    }
                }
                if (data.hasOwnProperty('activeShift')) {
                    if (JSON.stringify(activeShift) !== JSON.stringify(data.activeShift)) {
                        activeShift = data.activeShift;
                        if (activeShift) {
                            localStorage.setItem('multimango_active_shift', JSON.stringify(activeShift));
                        } else {
                            localStorage.removeItem('multimango_active_shift');
                        }
                        hasChanges = true;
                    }
                }
                
                if (hasChanges) {
                    renderLogs();
                    if (typeof renderPaymentCalendar === 'function') renderPaymentCalendar();
                    if (activeShift) resumeActiveShift();
                    else updateUIForInactiveShift();
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
        const key = p.woKey || p.id;
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

    // Shift Start/End buttons & Manual Add
    if (btnStartShift) btnStartShift.addEventListener('click', startShift);
    if (btnEndShift) btnEndShift.addEventListener('click', endShift);

    const btnAddManualLog = document.getElementById('btn-add-manual-log');
    if (btnAddManualLog) {
        btnAddManualLog.addEventListener('click', addManualShiftLog);
    }

    // Task Counter buttons
    if (btnPlusTask) btnPlusTask.addEventListener('click', incrementTask);
    if (btnMinusTask) btnMinusTask.addEventListener('click', decrementTask);

    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Filters
    filterStartDate.addEventListener('change', () => {
        const startVal = filterStartDate.value;
        if (startVal) {
            const startDate = new Date(startVal);
            // 7 days inclusive: StartDate + 6 days
            startDate.setDate(startDate.getDate() + 6);
            
            const year = startDate.getFullYear();
            const month = String(startDate.getMonth() + 1).padStart(2, '0');
            const day = String(startDate.getDate()).padStart(2, '0');
            filterEndDate.value = `${year}-${month}-${day}`;
        }
        renderLogs();
    });
    filterEndDate.addEventListener('change', renderLogs);
    btnResetFilters.addEventListener('click', resetFilters);
    const btnClearFilters = document.getElementById('btn-clear-filters');
    if (btnClearFilters) {
        btnClearFilters.addEventListener('click', clearFilters);
    }

    // Export/Import/Restore
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportToCSV);
    if (btnExportJson) btnExportJson.addEventListener('click', exportToJSON);
    if (btnImportJson) btnImportJson.addEventListener('click', () => fileImportInput && fileImportInput.click());
    if (fileImportInput) fileImportInput.addEventListener('change', importFromJSON);

    const btnForceRestore = document.getElementById('btn-force-restore-cloud');
    if (btnForceRestore) {
        btnForceRestore.addEventListener('click', async () => {
            showToast('Fetching & restoring full history from Firebase Cloud...', 'info');
            const res = await fetchFromCloud();
            if (res) {
                renderLogs();
                showToast('All 31 history logs restored from Firebase Cloud!', 'success');
            } else {
                showToast('Failed to connect to Firebase Cloud.', 'danger');
            }
        });
    }

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

function addManualShiftLog() {
    const date = shiftDateInput.value;
    const startTime = getStepperTime('shift-start');
    const endTime = getStepperTime('shift-end');
    const tasks = parseInt(counterDisplay.textContent) || 0;

    if (!date || !startTime || !endTime) {
        showToast('Please select shift date, start time, and end time!', 'danger');
        return;
    }

    const duration = getDurationHours(startTime, endTime);
    if (duration <= 0) {
        showToast('End Time must be later than Start Time!', 'danger');
        return;
    }

    const rate = duration > 0 ? Number((tasks / duration).toFixed(2)) : 0;
    const newLog = {
        id: Date.now().toString(),
        shiftId: 'manual_' + Date.now(),
        date: date,
        startTime: startTime,
        endTime: endTime,
        duration: duration,
        tasks: tasks,
        rate: rate
    };

    logs.push(newLog);
    logs.sort((a, b) => b.id.localeCompare(a.id));
    saveData();
    renderLogs();
    showToast(`Saved completed shift log for ${date} (${duration.toFixed(2)}h, ${tasks} tasks)!`, 'success');
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
    const targetTbody = document.getElementById('logs-tbody') || document.getElementById('history-table-body');
    if (!targetTbody) return;

    const startFilter = filterStartDate ? filterStartDate.value : '';
    const endFilter = filterEndDate ? filterEndDate.value : '';

    let filtered = logs;

    if (startFilter) {
        filtered = filtered.filter(log => log.date >= startFilter);
    }
    if (endFilter) {
        filtered = filtered.filter(log => log.date <= endFilter);
    }

    targetTbody.innerHTML = '';

    const emptyEl = document.getElementById('empty-state');
    if (filtered.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';

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
            targetTbody.appendChild(mainTr);

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
                    targetTbody.appendChild(subTr);
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
    if (filterStartDate) filterStartDate.value = todayStr;
    if (filterEndDate) filterEndDate.value = todayStr;
    renderLogs();
    showToast('Filters reset to Today', 'info');
}

function clearFilters() {
    if (filterStartDate) filterStartDate.value = '';
    if (filterEndDate) filterEndDate.value = '';
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

// ==========================================================================
// PAYMENT CALENDAR & GMAIL AUTO-SYNC ENGINE
// ==========================================================================

let paymentEvents = [];
let currentCalDate = new Date();
const GOOGLE_CLIENT_ID = '848704186375-qcg8qv6rugiaud1fqan4raoi8nb5s2uf.apps.googleusercontent.com';
let tokenClient = null;

// Initialize saved payment events on startup
(function initPaymentsState() {
    const savedPayments = localStorage.getItem('multimango_payments');
    if (savedPayments) {
        try {
            paymentEvents = JSON.parse(savedPayments);
        } catch(e) {
            paymentEvents = [];
        }
    }
})();

// Navigation View Mode Tabs
document.addEventListener('DOMContentLoaded', () => {
    const tabShiftTracker = document.getElementById('tab-shift-tracker');
    const tabPaymentCalendar = document.getElementById('tab-payment-calendar');
    const viewShiftTracker = document.getElementById('view-shift-tracker');
    const viewPaymentCalendar = document.getElementById('view-payment-calendar');

    if (tabShiftTracker && tabPaymentCalendar) {
        tabShiftTracker.addEventListener('click', () => {
            tabShiftTracker.classList.add('active');
            tabPaymentCalendar.classList.remove('active');
            viewShiftTracker.classList.add('active');
            viewPaymentCalendar.classList.remove('active');
        });

        tabPaymentCalendar.addEventListener('click', () => {
            tabPaymentCalendar.classList.add('active');
            tabShiftTracker.classList.remove('active');
            viewPaymentCalendar.classList.add('active');
            viewShiftTracker.classList.remove('active');
            renderPaymentCalendar();
        });
    }

    // Month Navigation Controls
    const btnCalPrev = document.getElementById('btn-cal-prev-month');
    const btnCalNext = document.getElementById('btn-cal-next-month');
    if (btnCalPrev && btnCalNext) {
        btnCalPrev.addEventListener('click', () => {
            currentCalDate.setMonth(currentCalDate.getMonth() - 1);
            renderPaymentCalendar();
        });
        btnCalNext.addEventListener('click', () => {
            currentCalDate.setMonth(currentCalDate.getMonth() + 1);
            renderPaymentCalendar();
        });
    }

    // Gmail Connect Button
    const btnConnectGmail = document.getElementById('btn-connect-gmail');
    if (btnConnectGmail) {
        btnConnectGmail.addEventListener('click', handleGmailConnect);
    }

    // Close Payment Modal
    const btnClosePayModal = document.getElementById('btn-close-pay-modal');
    const payModal = document.getElementById('payment-modal');
    if (btnClosePayModal && payModal) {
        btnClosePayModal.addEventListener('click', () => {
            payModal.classList.remove('active');
        });
    }

    // Auto-restore saved Gmail token on load
    const savedGmailToken = localStorage.getItem('gmail_token');
    if (savedGmailToken) {
        updateGmailStatusUI(true);
        fetchGmailPayments(savedGmailToken);
    }

    // Initial render of calendar
    renderPaymentCalendar();
});

// Google Identity Services (GIS) Auth Initializer
function handleGmailConnect() {
    // If we already have a saved token, try syncing first
    const savedToken = localStorage.getItem('gmail_token');

    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        showToast('Google API Client Library loading... Please try again in a moment.', 'danger');
        return;
    }

    if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            callback: async (response) => {
                if (response.error) {
                    showToast('Gmail authentication error: ' + response.error, 'danger');
                    return;
                }
                if (response.access_token) {
                    localStorage.setItem('gmail_token', response.access_token);
                    updateGmailStatusUI(true);
                    showToast('Gmail connected! Scanning Work Orders & Payments...', 'success');
                    await fetchGmailPayments(response.access_token);
                }
            }
        });
    }

    tokenClient.requestAccessToken();
}

function updateGmailStatusUI(isConnected) {
    const statusBadge = document.getElementById('gmail-sync-status');
    const btnText = document.getElementById('gmail-btn-text');
    if (statusBadge) {
        if (isConnected) {
            statusBadge.textContent = '● Gmail: Connected';
            statusBadge.classList.add('connected');
        } else {
            statusBadge.textContent = '● Gmail: Not Connected';
            statusBadge.classList.remove('connected');
        }
    }
    if (btnText) {
        btnText.textContent = isConnected ? 'Sync Gmail Now' : 'Connect Gmail Auto-Sync';
    }
}

// Fetch & Parse Gmail Payments
async function fetchGmailPayments(accessToken) {
    if (!accessToken) return;
    const query = 'no-reply@rws.com OR rws-payments@rws.com OR "Work Order Created" OR "Payment submitted" OR "Tipalti payment processed"';
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`;

    try {
        const res = await fetch(listUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('gmail_token');
            updateGmailStatusUI(false);
            showToast('Gmail session expired. Please click "Connect Gmail" to re-authenticate.', 'info');
            return;
        }
        if (!res.ok) throw new Error('Gmail API HTTP error ' + res.status);
        const data = await res.json();
        
        if (!data.messages || data.messages.length === 0) {
            showToast('No RWS/Tipalti payment emails found in your Inbox.', 'info');
            return;
        }

        let newEventsFound = 0;

        for (const msg of data.messages) {
            const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
            const msgRes = await fetch(msgUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (msgRes.ok) {
                const msgData = await msgRes.json();
                const processed = await parseSingleGmailMessage(msgData, accessToken);
                if (processed) newEventsFound++;
            }
        }

        saveData();
        renderPaymentCalendar();
        showToast(`Gmail Sync Complete! ${newEventsFound} payment milestones updated.`, 'success');
    } catch (e) {
        console.warn('Error fetching Gmail messages:', e);
        showToast('Could not fetch Gmail emails: ' + e.message, 'danger');
    }
}

// Single Email Message Parser
async function parseSingleGmailMessage(msgData, accessToken) {
    const headers = msgData.payload.headers || [];
    const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '';
    const internalDate = Number(msgData.internalDate || Date.now());
    const emailDateStr = new Date(internalDate).toISOString().split('T')[0];

    let bodyText = extractEmailBodyText(msgData.payload);
    let attachmentHtml = '';

    // Check for HTML Attachment (e.g. Work Order Document)
    const parts = msgData.payload.parts || [];
    for (const part of parts) {
        if (part.filename && (part.filename.endsWith('.html') || part.filename.endsWith('.htm')) && part.body && part.body.attachmentId) {
            try {
                const attachUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgData.id}/attachments/${part.body.attachmentId}`;
                const attachRes = await fetch(attachUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                if (attachRes.ok) {
                    const attachData = await attachRes.json();
                    if (attachData.data) {
                        attachmentHtml = atob(attachData.data.replace(/-/g, '+').replace(/_/g, '/'));
                    }
                }
            } catch(e){}
        }
    }

    let modified = false;

    // EVENT TYPE 1: WORK ORDER CREATED
    if (subject.toLowerCase().includes('work order created')) {
        let docNo = '';
        let amountUsd = 0;
        let workPeriodStart = '';
        let workPeriodEnd = '';
        let projectName = '';

        // Match Doc No in Body/Subject (e.g., Z3426188112)
        const docMatch = (bodyText + attachmentHtml).match(/Z\d{9,12}/i);
        if (docMatch) docNo = docMatch[0];

        // Match Work Period Range (e.g., 07/18/2026_to_07/24/2026)
        const periodMatch = (bodyText + attachmentHtml).match(/(\d{2}\/\d{2}\/\d{4})_to_(\d{2}\/\d{2}\/\d{4})/);
        if (periodMatch) {
            workPeriodStart = convertUsDateToIso(periodMatch[1]);
            workPeriodEnd = convertUsDateToIso(periodMatch[2]);
        }

        // Match Total Amount USD
        const amountMatch = (bodyText + attachmentHtml).match(/Total Amount:[\s\S]*?(\d+\.\d{2})|Total USD[\s\S]*?(\d+\.\d{2})/i);
        if (amountMatch) {
            amountUsd = Number(amountMatch[1] || amountMatch[2]);
        }

        // Match Project Name
        const projMatch = (bodyText + attachmentHtml).match(/META_[A-Z0-9_]+/i);
        if (projMatch) projectName = projMatch[0];

        if (docNo || amountUsd > 0) {
            const woKey = docNo || `WO_${emailDateStr}_${amountUsd}`;
            let existing = paymentEvents.find(p => p.woKey === woKey);
            if (!existing) {
                existing = {
                    id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    woKey: woKey,
                    docNo: docNo || woKey,
                    amountUsd: amountUsd,
                    amountIdr: 0,
                    workPeriodStart: workPeriodStart,
                    workPeriodEnd: workPeriodEnd,
                    projectName: projectName,
                    stage1Date: emailDateStr,
                    stage2Date: null,
                    stage3Date: null,
                    status: 'WO_CREATED'
                };
                paymentEvents.push(existing);
                modified = true;
            } else {
                if (workPeriodStart) existing.workPeriodStart = workPeriodStart;
                if (workPeriodEnd) existing.workPeriodEnd = workPeriodEnd;
                if (amountUsd > 0) existing.amountUsd = amountUsd;
                modified = true;
            }
        }
    }

    // EVENT TYPE 2: RWS PAYMENT SUBMITTED
    else if (subject.toLowerCase().includes('payment submitted')) {
        let amountUsd = 0;
        let subDate = emailDateStr;

        const amtMatch = bodyText.match(/Amount:\s*(\d+\.\d{2})/i);
        if (amtMatch) amountUsd = Number(amtMatch[1]);

        const dateMatch = bodyText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i);
        if (dateMatch) {
            try { subDate = new Date(dateMatch[0]).toISOString().split('T')[0]; } catch(e){}
        }

        if (amountUsd > 0) {
            // Find existing event by amount or update latest pending
            let target = paymentEvents.find(p => p.amountUsd === amountUsd && !p.stage2Date);
            if (!target) target = paymentEvents.find(p => !p.stage2Date);

            if (target) {
                target.stage2Date = subDate;
                if (target.status === 'WO_CREATED') target.status = 'PROCESSING';
                modified = true;
            } else {
                paymentEvents.push({
                    id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    woKey: `SUB_${subDate}_${amountUsd}`,
                    docNo: `SUB_${amountUsd}`,
                    amountUsd: amountUsd,
                    amountIdr: 0,
                    workPeriodStart: '',
                    workPeriodEnd: '',
                    projectName: '',
                    stage1Date: subDate,
                    stage2Date: subDate,
                    stage3Date: null,
                    status: 'PROCESSING'
                });
                modified = true;
            }
        }
    }

    // EVENT TYPE 3: TIPALTI PAYMENT PROCESSED SUCCESSFULLY
    else if (subject.toLowerCase().includes('payment processed successfully')) {
        let amountUsd = 0;
        let amountIdr = 0;
        let docRef = '';

        const usdMatch = bodyText.match(/USD\s+(\d+\.\d{2})/i);
        if (usdMatch) amountUsd = Number(usdMatch[1]);

        const idrMatch = bodyText.match(/IDR\s+([\d,]+(?:\.\d{2})?)/i);
        if (idrMatch) {
            amountIdr = Number(idrMatch[1].replace(/,/g, ''));
        }

        const refMatch = bodyText.match(/PTIP[A-Z0-9]+/i);
        if (refMatch) docRef = refMatch[0];

        if (amountUsd > 0 || amountIdr > 0) {
            let target = paymentEvents.find(p => p.amountUsd === amountUsd && !p.stage3Date);
            if (!target) target = paymentEvents.find(p => !p.stage3Date);

            if (target) {
                target.stage3Date = emailDateStr;
                if (amountIdr > 0) target.amountIdr = amountIdr;
                if (docRef) target.docRef = docRef;
                target.status = 'CLEARED';
                modified = true;
            } else {
                paymentEvents.push({
                    id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    woKey: docRef || `PAID_${emailDateStr}_${amountUsd}`,
                    docNo: docRef || `PAID_${amountUsd}`,
                    amountUsd: amountUsd,
                    amountIdr: amountIdr,
                    workPeriodStart: '',
                    workPeriodEnd: '',
                    projectName: '',
                    stage1Date: emailDateStr,
                    stage2Date: emailDateStr,
                    stage3Date: emailDateStr,
                    status: 'CLEARED'
                });
                modified = true;
            }
        }
    }

    return modified;
}

// Helper: Extract Email Body Text
function extractEmailBodyText(payload) {
    if (!payload) return '';
    if (payload.body && payload.body.data) {
        return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    if (payload.parts && payload.parts.length > 0) {
        let text = '';
        for (const part of payload.parts) {
            text += extractEmailBodyText(part);
        }
        return text;
    }
    return '';
}

// Helper: Convert MM/DD/YYYY to YYYY-MM-DD
function convertUsDateToIso(usDateStr) {
    const parts = usDateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    return usDateStr;
}

// Render Payment Calendar Grid & Summary Widgets
function renderPaymentCalendar() {
    const monthTitle = document.getElementById('cal-month-year-title');
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    if (monthTitle) monthTitle.textContent = `${monthNames[month]} ${year}`;

    // Get First Day of Month (0 = Sun, 1 = Mon, ..., 6 = Sat)
    const firstDay = new Date(year, month, 1);
    let startDayOfWeek = firstDay.getDay(); // 0 is Sun
    if (startDayOfWeek === 0) startDayOfWeek = 7; // Convert to Mon=1, ..., Sun=7

    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const todayStr = getTodayDateString();

    // Render Previous Month Padding Cells
    for (let i = startDayOfWeek - 1; i > 0; i--) {
        const pDay = prevMonthLastDay - i + 1;
        const cell = document.createElement('div');
        cell.className = 'calendar-cell other-month';
        cell.innerHTML = `<div class="cal-date-num">${pDay}</div>`;
        grid.appendChild(cell);
    }

    // Map Events by Date
    const eventsByDate = {};
    paymentEvents.forEach(evt => {
        if (evt.stage1Date) addEventToMap(eventsByDate, evt.stage1Date, evt, 1);
        if (evt.stage2Date) addEventToMap(eventsByDate, evt.stage2Date, evt, 2);
        if (evt.stage3Date) addEventToMap(eventsByDate, evt.stage3Date, evt, 3);
    });

    // Render Current Month Cells
    for (let day = 1; day <= lastDayOfMonth; day++) {
        const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        if (dayStr === todayStr) cell.classList.add('today');

        let cellContent = `<div class="cal-date-num">${day}</div>`;

        if (eventsByDate[dayStr]) {
            eventsByDate[dayStr].forEach(item => {
                const stageClass = item.stage === 1 ? 'stage-1' : (item.stage === 2 ? 'stage-2' : 'stage-3');
                const stageLabel = item.stage === 1 ? 'WO Created' : (item.stage === 2 ? 'Tipalti Proc' : 'Cleared');
                const amountText = item.evt.amountUsd > 0 ? `$${item.evt.amountUsd.toFixed(2)}` : '';

                cellContent += `
                    <div class="cal-event-badge ${stageClass}" onclick="openPaymentEventDetail('${item.evt.id}')">
                        <span class="cal-event-title">${item.evt.docNo || 'WO'} (${stageLabel})</span>
                        <span class="cal-event-amount">${amountText}</span>
                    </div>
                `;
            });
        }

        cell.innerHTML = cellContent;
        grid.appendChild(cell);
    }

    // Render Next Month Padding Cells
    const totalCells = grid.children.length;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell other-month';
        cell.innerHTML = `<div class="cal-date-num">${i}</div>`;
        grid.appendChild(cell);
    }

    // Render Summary Widgets
    updatePaymentSummaryWidgets();
}

function addEventToMap(map, dateStr, evt, stage) {
    if (!map[dateStr]) map[dateStr] = [];
    // Avoid duplicate stage entries on same date
    if (!map[dateStr].some(e => e.evt.id === evt.id && e.stage === stage)) {
        map[dateStr].push({ evt: evt, stage: stage });
    }
}

// Update Summary Widgets
function updatePaymentSummaryWidgets() {
    let woCreatedSum = 0;
    let woCount = 0;
    let procSum = 0;
    let procCount = 0;
    let clearedUsdSum = 0;
    let clearedIdrSum = 0;
    let totalWaitDays = 0;
    let clearedCount = 0;

    paymentEvents.forEach(evt => {
        if (evt.status === 'WO_CREATED') {
            woCreatedSum += evt.amountUsd || 0;
            woCount++;
        } else if (evt.status === 'PROCESSING') {
            procSum += evt.amountUsd || 0;
            procCount++;
        } else if (evt.status === 'CLEARED') {
            clearedUsdSum += evt.amountUsd || 0;
            clearedIdrSum += evt.amountIdr || 0;
            clearedCount++;

            // Calculate Turnaround Days (Work End / Stage1 -> Stage3)
            const startDate = new Date(evt.workPeriodEnd || evt.stage1Date);
            const endDate = new Date(evt.stage3Date);
            const diffDays = Math.max(0, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)));
            totalWaitDays += diffDays;
        }
    });

    const avgWait = clearedCount > 0 ? Math.round(totalWaitDays / clearedCount) : 0;

    const elWoVal = document.getElementById('pay-sum-wo-created');
    const elWoCount = document.getElementById('pay-sum-wo-count');
    const elProcVal = document.getElementById('pay-sum-tipalti-proc');
    const elProcCount = document.getElementById('pay-sum-proc-count');
    const elClearedUsd = document.getElementById('pay-sum-cleared-usd');
    const elClearedIdr = document.getElementById('pay-sum-cleared-idr');
    const elAvgWait = document.getElementById('pay-sum-avg-wait');

    if (elWoVal) elWoVal.textContent = `$${woCreatedSum.toFixed(2)}`;
    if (elWoCount) elWoCount.textContent = `${woCount} Work Orders`;
    if (elProcVal) elProcVal.textContent = `$${procSum.toFixed(2)}`;
    if (elProcCount) elProcCount.textContent = `${procCount} Payments`;
    if (elClearedUsd) elClearedUsd.textContent = `$${clearedUsdSum.toFixed(2)}`;
    if (elClearedIdr) elClearedIdr.textContent = `Rp ${new Intl.NumberFormat('id-ID').format(clearedIdrSum)}`;
    if (elAvgWait) elAvgWait.textContent = `${avgWait} Days`;
}

// Open Payment Event Detail Modal
function openPaymentEventDetail(eventId) {
    const evt = paymentEvents.find(p => p.id === eventId);
    if (!evt) return;

    const modal = document.getElementById('payment-modal');
    const body = document.getElementById('pay-modal-body');
    if (!modal || !body) return;

    let periodHtml = 'N/A';
    if (evt.workPeriodStart && evt.workPeriodEnd) {
        periodHtml = `<strong style="color: var(--mango-primary);">${evt.workPeriodStart} to ${evt.workPeriodEnd}</strong>`;
    }

    let idrText = evt.amountIdr > 0 ? ` (Rp ${new Intl.NumberFormat('id-ID').format(evt.amountIdr)})` : '';

    body.innerHTML = `
        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); padding: 0.85rem; border-radius: 12px;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Document / WO No:</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">${evt.docNo || evt.woKey}</div>
            ${evt.projectName ? `<div style="font-size: 0.78rem; color: var(--mango-hover); margin-top: 0.2rem;">Project: ${evt.projectName}</div>` : ''}
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); padding: 0.75rem; border-radius: 10px;">
                <div style="font-size: 0.72rem; color: var(--text-muted);">Amount USD</div>
                <div style="font-size: 1.1rem; font-weight: 700; color: var(--success);">$${evt.amountUsd.toFixed(2)}</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); padding: 0.75rem; border-radius: 10px;">
                <div style="font-size: 0.72rem; color: var(--text-muted);">Status</div>
                <div style="font-size: 0.95rem; font-weight: 700; color: var(--accent-teal);">${evt.status}</div>
            </div>
        </div>

        <div style="background: rgba(255,255,255,0.03); border: 1px dashed var(--card-border); padding: 0.75rem; border-radius: 10px; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div>🗓️ <strong>Work Period:</strong> ${periodHtml}</div>
            <div>🔵 <strong>WO Created:</strong> ${evt.stage1Date || 'Pending'}</div>
            <div>🟡 <strong>Tipalti Submitted:</strong> ${evt.stage2Date || 'Pending'}</div>
            <div>🟢 <strong>Payment Cleared:</strong> ${evt.stage3Date || 'Pending'}${idrText}</div>
        </div>
    `;

    modal.classList.add('active');
}

