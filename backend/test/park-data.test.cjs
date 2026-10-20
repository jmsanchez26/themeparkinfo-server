const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchParkData, useHostedParkData } = require('../park-data');

test('keyless development reads only allowlisted public Render data and unwraps it', async () => {
  const data = { liveData: [{ id: 'test', name: 'Test Ride' }] };
  const calls = [];
  const result = await fetchParkData('wdw', undefined, {
    environment: {}, fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers, undefined);
      return { ok: true, json: async () => ({ data, lastUpdated: '2026-10-18T12:00:00Z' }) };
    }
  });
  assert.deepEqual(calls, ['https://themeparkinfo-api.onrender.com/park-feed/wdw']);
  assert.deepEqual(result.data, data);
  assert.equal(result.hosted, true);
  assert.equal(result.lastUpdated, '2026-10-18T12:00:00Z');
  await assert.rejects(fetchParkData('alerts', undefined));
  await assert.rejects(fetchParkData('https://evil.invalid', undefined));
});

test('production and explicit opt-out never fall back; configured upstream keeps precedence', async () => {
  assert.equal(useHostedParkData(undefined, { NODE_ENV: 'production' }), false);
  assert.equal(useHostedParkData(undefined, { USE_HOSTED_PARK_DATA: 'false' }), false);
  assert.equal(useHostedParkData('https://configured.invalid', {}), false);
  const fetcher = async () => { throw new Error('Must not fetch'); };
  assert.equal(await fetchParkData('wdw', undefined, { environment: { NODE_ENV: 'production' }, fetcher }), null);
  const data = { liveData: [] };
  const result = await fetchParkData('wdw', 'https://configured.invalid', {
    environment: {}, fetcher: async url => {
      assert.equal(url, 'https://configured.invalid');
      return { ok: true, json: async () => data };
    }
  });
  assert.equal(result.hosted, false);
  assert.deepEqual(result.data, data);
});

test('unavailable or malformed hosted responses fail rather than fabricating data', async () => {
  await assert.rejects(fetchParkData('wdw', undefined, { environment: {}, fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(fetchParkData('wdw', undefined, { environment: {}, fetcher: async () => ({ ok: true, json: async () => ({ data: {} }) }) }), /Invalid park data/);
});
