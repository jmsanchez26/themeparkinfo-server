const HOSTED_API = 'https://themeparkinfo-api.onrender.com';
const PARKS = new Set(['wdw', 'disneyland', 'usorlando', 'hollywood']);

function useHostedParkData(upstreamUrl, environment = process.env) {
  return !upstreamUrl && environment.NODE_ENV !== 'production' && environment.USE_HOSTED_PARK_DATA !== 'false';
}

async function fetchParkData(park, upstreamUrl, { environment = process.env, fetcher = fetch } = {}) {
  if (!PARKS.has(park)) throw new Error('Unsupported park');
  const hosted = useHostedParkData(upstreamUrl, environment);
  if (!upstreamUrl && !hosted) return null;
  // Fixed host and allowlisted public paths: never proxy private alerts or caller-selected URLs.
  let response = await fetcher(hosted ? `${HOSTED_API}/park-feed/${park}` : upstreamUrl, {
    signal: AbortSignal.timeout(15000)
  });
  // Compatible with the currently deployed pre-auth backend during rollout.
  if (hosted && (response.status === 404 || (response.ok && response.headers?.get('content-type')?.includes('text/html')))) {
    response = await fetcher(`${HOSTED_API}/api/${park}`, { signal: AbortSignal.timeout(15000) });
  }
  if (!response.ok) throw new Error(`Park data unavailable (HTTP ${response.status})`);
  const payload = await response.json();
  const data = hosted ? payload.data : payload;
  if (!data || !Array.isArray(data.liveData)) throw new Error('Invalid park data response');
  return { data, hosted, lastUpdated: hosted ? payload.lastUpdated : null };
}

module.exports = { fetchParkData, useHostedParkData };
