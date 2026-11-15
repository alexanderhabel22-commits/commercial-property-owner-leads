// Reads records from an ArcGIS REST layer (FeatureServer or MapServer).
//
// 1. Ask for the object IDs that match the filter (one small request).
// 2. Fetch the records in batches of IDs, a few batches at a time.
// This works on every ArcGIS server version and keeps each request small.

import { mapPool } from '../http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POSTs a form to an ArcGIS endpoint. ArcGIS reports errors inside a 200 response. */
export async function arcgisRequest(url, params, { timeoutMs = 90_000, retries = 3, log } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'commercial-property-owner-leads (Apify Actor)' },
                body: new URLSearchParams({ f: 'json', ...params }).toString(),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
            const json = await res.json();
            if (json.error) {
                const err = new Error(`ArcGIS error ${json.error.code ?? ''} ${json.error.message ?? ''} ${(json.error.details ?? []).join(' ')}`.trim());
                // A bad query will not get better on retry; a timeout might.
                if (json.error.code === 400 && attempt >= 1) err.fatal = true;
                throw err;
            }
            return json;
        } catch (err) {
            lastError = err;
            if (err.fatal || attempt === retries) break;
            const wait = 2000 * 2 ** attempt;
            log?.warning?.(`Request to ${new URL(url).host} failed (${err.message}); retrying in ${wait / 1000}s`);
            await sleep(wait);
        }
    }
    throw lastError;
}

/** Envelope parameters for a [south, west, north, east] box in WGS84. */
export function envelopeParams(bbox) {
    if (!bbox) return {};
    const [s, w, n, e] = bbox;
    return {
        geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
    };
}

/** Point [lat, lon] from a feature's centroid or point geometry. */
export function featurePoint(feature) {
    const g = feature.centroid ?? feature.geometry;
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
    if (Math.abs(g.y) > 90 || Math.abs(g.x) > 180) return null;
    return [Math.round(g.y * 1e6) / 1e6, Math.round(g.x * 1e6) / 1e6];
}

/**
 * Yields arrays of features matching `where`.
 * options: { outFields, bbox, batchSize, concurrency, centroid, pointLayer, maxRecords, shouldStop, log }
 */
export async function queryLayer(layerUrl, where, options = {}) {
    const { outFields = '*', bbox = null, batchSize = 1000, concurrency = 4, centroid = true, pointLayer = false, maxRecords = Infinity, shouldStop = () => false, log, onBatch } = options;
    const idsRes = await arcgisRequest(`${layerUrl}/query`, { where, returnIdsOnly: 'true', ...envelopeParams(bbox) }, { log });
    const ids = (idsRes.objectIds ?? []).sort((a, b) => a - b).slice(0, maxRecords);
    const oidField = idsRes.objectIdFieldName ?? 'OBJECTID';
    const batches = [];
    for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));
    log?.info?.(`${new URL(layerUrl).host}: ${ids.length} matching records, downloading in ${batches.length} batches`);
    let fetched = 0;
    await mapPool(batches, concurrency, async (batch) => {
        if (shouldStop()) return;
        const geometryParams = pointLayer
            ? { returnGeometry: 'true', outSR: '4326' }
            : { returnGeometry: 'false', ...(centroid ? { returnCentroid: 'true', outSR: '4326' } : {}) };
        const res = await arcgisRequest(`${layerUrl}/query`, {
            objectIds: batch.join(','),
            outFields,
            ...geometryParams,
        }, { log });
        fetched += res.features?.length ?? 0;
        await onBatch?.(res.features ?? []);
    });
    return { matched: ids.length, fetched, oidField };
}
