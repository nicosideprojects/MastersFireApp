// Tracks live API calls (pending/success/failed) so their status is visible
// Shared by both HTML pages

const MAX_LOGGED_CALLS = 20;

let calls = [];
let nextId = 1;
const listeners = [];

function notify() {
    listeners.slice().forEach(listener => listener(calls));
}

// the current call log with most recent first
function getApiCalls() {
    return calls;
}

// registers a listener for log changes and returns an unsubscribe function
function onApiCallsChange(listener) {
    listeners.push(listener);
    return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
    };
}

// empties the log
function clearApiCalls() {
    calls = [];
    notify();
}

// runs asyncFn and logs it as a named pending success or failed entry
async function trackApiCall(name, asyncFn) {
    const entry = { id: nextId++, name, status: 'pending', detail: '', startedAt: Date.now(), endedAt: null };
    calls = [entry, ...calls].slice(0, MAX_LOGGED_CALLS);
    notify();

    try {
        const result = await asyncFn();
        entry.status = 'success';
        entry.endedAt = Date.now();
        notify();
        return result;
    } catch (err) {
        entry.status = 'failed';
        entry.detail = err && err.message ? err.message : String(err);
        entry.endedAt = Date.now();
        notify();
        throw err;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { trackApiCall, getApiCalls, onApiCallsChange, clearApiCalls };
}
