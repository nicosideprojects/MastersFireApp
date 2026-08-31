// Run with: node --test tests/api-status.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { trackApiCall, getApiCalls, onApiCallsChange, clearApiCalls } = require('../app/api-status.js');

test.beforeEach(() => clearApiCalls());

test('trackApiCall: goes pending then success and returns the result', async () => {
    const statuses = [];
    const unsubscribe = onApiCallsChange(calls => statuses.push(calls[0].status));

    const result = await trackApiCall('test call', async () => 'ok');

    assert.equal(result, 'ok');
    assert.deepEqual(statuses, ['pending', 'success']);
    assert.equal(getApiCalls()[0].status, 'success');
    unsubscribe();
});

test('trackApiCall: records a failure with its message and throws', async () => {
    await assert.rejects(
        () => trackApiCall('failing call', async () => { throw new Error('this failed'); }),
        /this failed/
    );
    assert.equal(getApiCalls()[0].status, 'failed');
    assert.equal(getApiCalls()[0].detail, 'this failed');
});

test('trackApiCall: most recent call is first', async () => {
    await trackApiCall('first', async () => 1);
    await trackApiCall('second', async () => 2);
    assert.deepEqual(getApiCalls().map(c => c.name), ['second', 'first']);
});

test('clearApiCalls: empties the log', async () => {
    await trackApiCall('a call', async () => 1);
    clearApiCalls();
    assert.equal(getApiCalls().length, 0);
});

test('onApiCallsChange: unsubscribing stops further notifications', async () => {
    let count = 0;
    const unsubscribe = onApiCallsChange(() => { count++; });
    unsubscribe();
    await trackApiCall('ignored', async () => 1);
    assert.equal(count, 0);
});
