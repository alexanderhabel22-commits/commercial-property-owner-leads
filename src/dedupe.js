// Merges records that describe the same property.
//
// Assessor rolls often list one building as several records: a building and
// its parking lot, condo-style "parts" of one complex, or the same parcel
// twice. Two records are treated as one property when they come from the same
// source and have
//   - the same parcel ID, or
//   - the same owner and the same street address, or
//   - the same owner, the same (repeated) value and the same city or county,
//     which is how some counties record one complex spread over many parcels.

import { ownerKey, addressKey } from './normalize.js';

function keysFor(rec) {
    const keys = [];
    if (rec.parcel_id) keys.push(`p:${rec.source}|${rec.parcel_id}`);
    const owner = ownerKey(rec.owner_raw);
    const addr = addressKey(rec.property_address);
    if (owner && addr && /\d/.test(addr)) keys.push(`a:${rec.source}|${owner}|${addr}`);
    if (owner && rec.value_usd >= 250_000) keys.push(`v:${rec.source}|${owner}|${rec.value_usd}|${(rec.city ?? rec.county ?? '').toLowerCase()}`);
    return keys;
}

const max = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

function merge(into, from, how) {
    for (const [k, v] of Object.entries(from)) {
        if (into[k] == null || into[k] === '') into[k] = v;
    }
    const newParcel = from.parcel_id && !into.parcel_ids.includes(from.parcel_id);
    if (newParcel) into.parcel_ids.push(from.parcel_id);
    // Separate parcels at one address add up; a value repeated on every
    // parcel of one complex does not.
    if (newParcel && how === 'a' && from.value_usd !== into.value_usd) {
        into.value_usd = (into.value_usd ?? 0) + (from.value_usd ?? 0);
        into.land_value_usd = (into.land_value_usd ?? 0) + (from.land_value_usd ?? 0) || null;
        into.building_value_usd = (into.building_value_usd ?? 0) + (from.building_value_usd ?? 0) || null;
        into.lot_acres = Math.round(((into.lot_acres ?? 0) + (from.lot_acres ?? 0)) * 1000) / 1000 || null;
        into.building_sqft = (into.building_sqft ?? 0) + (from.building_sqft ?? 0) || null;
    } else {
        into.building_sqft = max(into.building_sqft, from.building_sqft);
    }
    into.units = max(into.units, from.units);
    into.floors = max(into.floors, from.floors);
    if (from.last_sale_date && (!into.last_sale_date || from.last_sale_date > into.last_sale_date)) {
        into.last_sale_date = from.last_sale_date;
        into.last_sale_price_usd = from.last_sale_price_usd;
    }
}

export class PropertyDeduper {
    constructor() {
        this.rows = [];
        this.index = new Map();
        this.merged = 0;
    }

    /** Adds a record. Returns true when it was new, false when merged. */
    add(rec) {
        const keys = keysFor(rec);
        const hitKey = keys.find((k) => this.index.has(k));
        if (hitKey === undefined) {
            const copy = { ...rec, parcel_ids: rec.parcel_id ? [rec.parcel_id] : [] };
            this.rows.push(copy);
            for (const k of keys) this.index.set(k, this.rows.length - 1);
            return true;
        }
        const i = this.index.get(hitKey);
        if (!hitKey.startsWith('p:')) merge(this.rows[i], rec, hitKey[0]);
        for (const k of keysFor(this.rows[i])) if (!this.index.has(k)) this.index.set(k, i);
        for (const k of keys) if (!this.index.has(k)) this.index.set(k, i);
        this.merged++;
        return false;
    }

    get size() {
        return this.rows.length;
    }
}
