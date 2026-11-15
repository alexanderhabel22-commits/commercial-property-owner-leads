// Commercial Property Owner Leads: Apify Actor entry point.
//
// 1. Read the input (areas, property types, value and size filters).
// 2. Query each public parcel source for commercial properties that match.
// 3. Keep only properties owned by companies (never individuals), merge
//    duplicate parcels, and work out each owner's portfolio in the results.
// 4. Push one row per property (or per owner) and charge the "lead" event.

import { pathToFileURL } from 'node:url';
import { Actor, log } from 'apify';
import { PROPERTY_TYPES, PROPERTY_TYPE_IDS } from './classify.js';
import { SOURCES, SOURCE_IDS, SOURCE_BY_ID, fetchSource } from './sources/index.js';
import { PropertyDeduper } from './dedupe.js';
import { ownerType, ownerKey, businessNameOrNull, prettyName, prettyAddress, zip5, isoDate, cleanMailStreet } from './normalize.js';
import { zipCentroid, isKnownZip, distanceMiles, statesWithinRadius, nearestZip } from './geo.js';
import { mapPool } from './http.js';

export const CHARGE_EVENT = 'lead';
export const OWNER_TYPES = ['company', 'nonprofit', 'government', 'religious'];

/** When Apify will stop the run, minus a margin for saving. Null locally. */
export function runDeadline(env = process.env, marginMs = 60_000) {
    const at = Date.parse(env.ACTOR_TIMEOUT_AT ?? env.APIFY_TIMEOUT_AT ?? '');
    return Number.isFinite(at) ? at - marginMs : null;
}

const clampInt = (v, def, lo, hi) => {
    if (v === null || v === undefined || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(Math.round(n), hi)) : def;
};

const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : [])
    .map((x) => String(x).trim()).filter(Boolean);

/** Validates and fills defaults. Throws a plain-language message on bad input. */
export function parseInput(raw = {}) {
    const zipCode = raw.zipCode ? String(raw.zipCode).trim().slice(0, 5) : null;
    if (zipCode && !isKnownZip(zipCode)) throw new Error(`ZIP code ${zipCode} was not found. Use a 5-digit US ZIP code.`);
    const radiusMiles = Number(raw.radiusMiles ?? 10);
    if (zipCode && !(radiusMiles > 0 && radiusMiles <= 100)) throw new Error('Radius must be between 1 and 100 miles.');

    let areas = [...new Set(list(raw.areas ?? (zipCode ? [] : ['MA'])).map((a) => a.toUpperCase()))];
    const badAreas = areas.filter((a) => !SOURCE_BY_ID[a]);
    if (badAreas.length) throw new Error(`Unknown area: ${badAreas.join(', ')}. Use one of ${SOURCE_IDS.join(', ')}.`);
    if (!areas.length && zipCode) {
        const states = statesWithinRadius(zipCentroid(zipCode), radiusMiles);
        areas = SOURCES.filter((s) => states.includes(s.state)).map((s) => s.id);
        if (!areas.length) throw new Error(`No covered area is within ${radiusMiles} miles of ${zipCode}. Covered: ${SOURCES.map((s) => s.area).join('; ')}.`);
    }
    if (!areas.length) throw new Error('Pick at least one area, or a ZIP code and radius inside a covered area.');

    const propertyTypes = [...new Set(list(raw.propertyTypes ?? ['office', 'industrial', 'warehouse']))];
    const badTypes = propertyTypes.filter((t) => !PROPERTY_TYPES[t]);
    if (badTypes.length) throw new Error(`Unknown property type: ${badTypes.join(', ')}. Use one of ${PROPERTY_TYPE_IDS.join(', ')}.`);

    const ownerTypes = list(raw.ownerTypes ?? ['company', 'nonprofit']);
    const badOwners = ownerTypes.filter((t) => !OWNER_TYPES.includes(t));
    if (badOwners.length) throw new Error(`Unknown owner type: ${badOwners.join(', ')}. Use one of ${OWNER_TYPES.join(', ')}.`);
    if (!ownerTypes.length) throw new Error('Pick at least one owner type.');

    const zipCodes = [...new Set(list(raw.zipCodes).map(zip5).filter(Boolean))];
    const cities = [...new Set(list(raw.cities))];
    const soldAfter = raw.soldAfter ? isoDate(String(raw.soldAfter)) : null;
    if (raw.soldAfter && !soldAfter) throw new Error('"Sold on or after" must be a date such as 2024-01-01.');
    const soldBefore = raw.soldBefore ? isoDate(String(raw.soldBefore)) : null;
    if (raw.soldBefore && !soldBefore) throw new Error('"Sold before" must be a date such as 2025-01-01.');

    const minValue = clampInt(raw.minValue === undefined ? 2_000_000 : raw.minValue, 0, 0, 1e12);
    const maxValue = clampInt(raw.maxValue, 0, 0, 1e12);
    if (maxValue && maxValue < minValue) throw new Error('Maximum value is below the minimum value.');
    const yearBuiltFrom = clampInt(raw.yearBuiltFrom, 0, 0, 2100);
    const yearBuiltTo = clampInt(raw.yearBuiltTo, 0, 0, 2100);

    const outputMode = raw.outputMode === 'owners' ? 'owners' : 'properties';
    return {
        areas,
        propertyTypes,
        cities,
        zipCodes,
        zipCode,
        radiusMiles,
        minValue,
        maxValue,
        minBuildingSqft: clampInt(raw.minBuildingSqft, 0, 0, 1e8),
        yearBuiltFrom,
        yearBuiltTo,
        soldAfter,
        soldBefore,
        ownerTypes,
        absenteeOnly: raw.absenteeOnly === true,
        minOwnerProperties: clampInt(raw.minOwnerProperties, 1, 1, 10_000),
        outputMode,
        maxResults: clampInt(raw.maxResults, 1000, 1, 200_000),
    };
}

/** [south, west, north, east] box around a point, padded a little. */
export function boundingBox([lat, lon], miles) {
    const dLat = (miles * 1.05) / 69;
    const dLon = (miles * 1.05) / (69 * Math.cos((lat * Math.PI) / 180));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => Math.round(v * 1e5) / 1e5);
}

/**
 * Record-level filters that every source shares. Returns a reason string
 * when the record is dropped, or null when it is kept.
 */
export function rejectReason(rec, input, centre = null) {
    if (!rec.property_type) return 'not_commercial';
    if (input.propertyTypes.length && !input.propertyTypes.includes(rec.property_type)) return 'property_type';
    if (input.minValue && !(rec.value_usd >= input.minValue)) return 'value';
    if (input.maxValue && !(rec.value_usd <= input.maxValue)) return 'value';
    if (input.minBuildingSqft && !(rec.building_sqft >= input.minBuildingSqft)) return 'building_size';
    if (input.yearBuiltFrom && !(rec.year_built >= input.yearBuiltFrom)) return 'year_built';
    if (input.yearBuiltTo && !(rec.year_built && rec.year_built <= input.yearBuiltTo)) return 'year_built';
    if (input.soldAfter && !(rec.last_sale_date && rec.last_sale_date >= input.soldAfter)) return 'sale_date';
    if (input.soldBefore && !(rec.last_sale_date && rec.last_sale_date < input.soldBefore)) return 'sale_date';
    if (input.zipCodes.length && !input.zipCodes.includes(rec.zip)) return 'zip';
    // City filters run on each source's server (see sources/index.js).
    if (centre) {
        const p = rec._point ?? zipCentroid(rec.zip);
        if (!p) return 'distance';
        rec._distance = distanceMiles(centre, p);
        if (rec._distance > input.radiusMiles) return 'distance';
    }
    const type = ownerType(rec.owner_raw);
    rec._ownerType = type;
    if (type === 'person' || type === 'unknown') return 'owner_is_person';
    if (!input.ownerTypes.includes(type)) return 'owner_type';
    if (input.absenteeOnly && !(rec.mail_state && rec.mail_state !== rec.state)) return 'not_absentee';
    return null;
}

const joinAddress = (...parts) => parts.filter(Boolean).join(', ') || null;

/** Final property row with a fixed field order and no internal fields. */
export function toPropertyRow(rec, input, portfolio, scrapedAt) {
    const mailCityLine = [rec.mail_city ? prettyName(rec.mail_city) : null, [rec.mail_state, rec.mail_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const point = rec._point;
    const mailStreet = cleanMailStreet(rec.mail_street);
    const city = rec.city && !/^(uninc\w*|unincorporated|none)$/i.test(rec.city) ? rec.city : null;
    return {
        owner_name: prettyName(String(rec.owner_raw).replace(/^(c\/o|attn:?)\s+/i, '')),
        owner_type: rec._ownerType,
        owner_name_2: prettyName(businessNameOrNull(rec.owner2_raw)),
        owner_care_of: prettyName(businessNameOrNull(rec.care_of_raw)),
        owner_mailing_address: joinAddress(prettyAddress(mailStreet), mailCityLine || null),
        owner_mailing_street: prettyAddress(mailStreet),
        owner_mailing_city: prettyName(rec.mail_city),
        owner_mailing_state: rec.mail_state,
        owner_mailing_zip: rec.mail_zip,
        owner_out_of_state: rec.mail_state ? rec.mail_state !== rec.state : null,
        owner_property_count: portfolio?.count ?? 1,
        owner_portfolio_value_usd: portfolio?.value ?? rec.value_usd,
        property_address: prettyAddress(rec.property_address),
        city: prettyName(city),
        county: prettyName(rec.county),
        state: rec.state,
        zip: rec.zip,
        latitude: point?.[0] ?? null,
        longitude: point?.[1] ?? null,
        distance_miles: input.zipCode && rec._distance != null ? Math.round(rec._distance * 10) / 10 : null,
        property_type: rec.property_type,
        property_type_label: PROPERTY_TYPES[rec.property_type],
        land_use_description: rec.land_use_description,
        land_use_code: rec.land_use_code,
        building_sqft: rec.building_sqft,
        lot_acres: rec.lot_acres,
        year_built: rec.year_built,
        floors: rec.floors,
        units: rec.units,
        value_usd: rec.value_usd,
        value_type: rec.value_type,
        land_value_usd: rec.land_value_usd,
        building_value_usd: rec.building_value_usd,
        last_sale_date: rec.last_sale_date,
        last_sale_price_usd: rec.last_sale_price_usd > 100 ? rec.last_sale_price_usd : null,
        zoning: rec.zoning,
        parcel_id: rec.parcel_id,
        parcel_count: rec.parcel_ids?.length || 1,
        source: rec.source,
        source_name: rec.source_name,
        source_url: rec.source_url,
        scraped_at: scrapedAt,
    };
}

/** One row per owner: their properties in the results, biggest first. */
export function toOwnerRows(propertyRows) {
    const groups = new Map();
    for (const r of propertyRows) {
        const key = ownerKey(r.owner_name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const rows = [];
    for (const props of groups.values()) {
        props.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));
        const first = props.find((p) => p.owner_mailing_address) ?? props[0];
        const count = (field) => {
            const c = {};
            for (const p of props) if (p[field]) c[p[field]] = (c[p[field]] ?? 0) + 1;
            return c;
        };
        rows.push({
            owner_name: props[0].owner_name,
            owner_type: props[0].owner_type,
            owner_mailing_address: first.owner_mailing_address,
            owner_mailing_street: first.owner_mailing_street,
            owner_mailing_city: first.owner_mailing_city,
            owner_mailing_state: first.owner_mailing_state,
            owner_mailing_zip: first.owner_mailing_zip,
            property_count: props.length,
            total_value_usd: props.reduce((s, p) => s + (p.value_usd ?? 0), 0),
            total_building_sqft: props.reduce((s, p) => s + (p.building_sqft ?? 0), 0) || null,
            property_types: count('property_type'),
            states: [...new Set(props.map((p) => p.state))],
            cities: [...new Set(props.map((p) => p.city).filter(Boolean))].slice(0, 25),
            largest_property_address: joinAddress(props[0].property_address, props[0].city, props[0].state),
            largest_property_value_usd: props[0].value_usd,
            latest_purchase_date: props.map((p) => p.last_sale_date).filter(Boolean).sort().at(-1) ?? null,
            properties: props.slice(0, 100).map((p) => ({
                property_address: p.property_address, city: p.city, state: p.state, zip: p.zip,
                property_type: p.property_type, value_usd: p.value_usd, building_sqft: p.building_sqft,
                year_built: p.year_built, last_sale_date: p.last_sale_date, parcel_id: p.parcel_id,
            })),
            sources: [...new Set(props.map((p) => p.source))],
            scraped_at: props[0].scraped_at,
        });
    }
    return rows.sort((a, b) => b.property_count - a.property_count || b.total_value_usd - a.total_value_usd);
}

export async function collect(input, { log: logger = log, deadline = runDeadline() } = {}) {
    const outOfTime = () => deadline != null && Date.now() > deadline;
    let warnedTime = false;
    const shouldStop = () => {
        if (!outOfTime()) return false;
        if (!warnedTime) logger.warning('Running out of time: skipping the rest of the downloads. Raise the run timeout to get everything.');
        warnedTime = true;
        return true;
    };
    const scrapedAt = new Date().toISOString();
    const centre = input.zipCode ? zipCentroid(input.zipCode) : null;
    const bbox = centre ? boundingBox(centre, input.radiusMiles) : null;
    const deduper = new PropertyDeduper();
    const stats = {};
    const sources = input.areas.map((id) => SOURCE_BY_ID[id]);

    await mapPool(sources, 3, async (source) => {
        const st = (stats[source.id] = { records: 0, kept: 0, dropped: {}, error: null, seconds: 0 });
        const t0 = Date.now();
        // Skip sources a city filter cannot match (e.g. "Boston" for NYC).
        if (input.cities.length && source.citySupported && !source.citySupported(input.cities)) {
            st.dropped.city_not_in_area = 'skipped';
            return;
        }
        logger.info(`${source.area}: searching ${source.label}`);
        const filters = { minValue: input.minValue, cities: input.cities, zips: input.zipCodes, bbox, propertyTypes: input.propertyTypes };
        try {
            await fetchSource(source, filters, {
                log: logger,
                shouldStop,
                onRecord: (rec) => {
                    st.records++;
                    if (!rec.zip && rec._point && (centre || input.zipCodes.length || source.id === 'NC' || source.id === 'DC')) {
                        const near = nearestZip(rec._point);
                        if (near && near.miles < 5) rec.zip = near.zip;
                    }
                    const reason = rejectReason(rec, input, centre);
                    if (reason) {
                        st.dropped[reason] = (st.dropped[reason] ?? 0) + 1;
                        return;
                    }
                    st.kept++;
                    deduper.add(rec);
                },
            });
        } catch (err) {
            st.error = err.message;
            logger.warning(`${source.label} failed: ${err.message}`);
        }
        st.seconds = Math.round((Date.now() - t0) / 1000);
        logger.info(`${source.area}: ${st.records} records read, ${st.kept} kept`, { dropped: st.dropped });
    });

    // Owner portfolios within the results.
    const portfolios = new Map();
    for (const r of deduper.rows) {
        const k = ownerKey(r.owner_raw);
        const p = portfolios.get(k) ?? { count: 0, value: 0 };
        p.count++;
        p.value += r.value_usd ?? 0;
        portfolios.set(k, p);
    }
    let rows = deduper.rows
        .map((r) => toPropertyRow(r, input, portfolios.get(ownerKey(r.owner_raw)), scrapedAt))
        .filter((r) => r.owner_property_count >= input.minOwnerProperties);
    rows.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0) || (a.distance_miles ?? 0) - (b.distance_miles ?? 0));
    if (input.outputMode === 'owners') rows = toOwnerRows(rows);
    return { rows, stats, merged: deduper.merged };
}

async function run() {
    await Actor.init();
    const input = parseInput((await Actor.getInput()) ?? {});
    log.info('Input', input);

    const { rows, stats, merged } = await collect(input);
    const sourceStats = Object.values(stats);
    if (rows.length === 0 && sourceStats.length && sourceStats.every((s) => s.error)) {
        throw new Error('Every data source failed. See the log for details.');
    }

    // Respect both maxResults and the spending limit the user set for the run.
    const charging = Actor.getChargingManager();
    const affordable = charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    const limit = Math.min(input.maxResults, Number.isFinite(affordable) ? affordable : Infinity);
    const out = rows.slice(0, limit);
    for (let i = 0; i < out.length; i += 200) {
        const res = await Actor.pushData(out.slice(i, i + 200), CHARGE_EVENT);
        if (res?.eventChargeLimitReached) {
            log.info('Reached the spending limit for this run.');
            break;
        }
    }

    const what = input.outputMode === 'owners' ? 'owners' : 'properties';
    const summary = { found: rows.length, returned: out.length, output: what, duplicate_parcels_merged: merged, with_mailing_address: out.filter((r) => r.owner_mailing_address).length, sources: stats };
    await Actor.setValue('RUN_SUMMARY', summary);
    log.info('Done', summary);
    const failed = sourceStats.filter((s) => s.error).length;
    await Actor.setStatusMessage(`Found ${rows.length} matching ${what}, returned ${out.length}.${failed ? ` ${failed} source(s) failed; see the log.` : ''}`, { isStatusMessageTerminal: true });
    await Actor.exit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run().catch(async (err) => {
        log.error(err.message);
        await Actor.fail(err.message);
    });
}
