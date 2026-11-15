// Helpers that clean up owner names, addresses and numbers so records from
// different county and state systems look the same.

export const US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]));

/** "Ohio", "ohio" or "OH" -> "OH". Unknown values -> null. */
export function stateAbbr(value) {
    if (!value) return null;
    const v = String(value).trim();
    if (US_STATES[v.toUpperCase()]) return v.toUpperCase();
    return STATE_BY_NAME[v.toLowerCase()] ?? null;
}

/** Trimmed string with single spaces, or null when empty. */
export function clean(value) {
    if (value == null) return null;
    const v = String(value).replace(/\s+/g, ' ').trim();
    return v && !/^(null|none|n\/a|-+|0)$/i.test(v) ? v : null;
}

/** Positive finite number, or null. Accepts "1,234". */
export function num(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Plausible build year, or null. */
export function year(value) {
    const n = Math.round(Number(value));
    return n >= 1700 && n <= new Date().getFullYear() + 2 ? n : null;
}

/** First 5 digits of a ZIP, or null. */
export function zip5(value) {
    const m = String(value ?? '').match(/\b(\d{5})(?:-?\d{4})?\b/);
    return m && m[1] !== '00000' ? m[1] : null;
}

/**
 * Dates arrive as epoch milliseconds, "YYYYMMDD", "M/D/YYYY ..." or ISO
 * strings. Returns "YYYY-MM-DD" or null.
 */
export function isoDate(value) {
    if (value == null || value === '') return null;
    let d;
    if (typeof value === 'number') d = new Date(value);
    else {
        const s = String(value).trim();
        let m;
        if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
        else d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    if (y <= 1900 || y > new Date().getFullYear() + 1) return null;
    return d.toISOString().slice(0, 10);
}

const KEEP_UPPER = new Set(['LLC', 'LLP', 'LP', 'LLLP', 'PLLC', 'USA', 'US', 'II', 'III', 'IV', 'PC', 'NA', 'REIT', 'JV', 'NY', 'NYC', 'MA', 'CT', 'NC', 'DC', 'PA', 'OH', 'WI', 'MN', 'SE', 'NE', 'NW', 'SW', 'PO', 'CVS', 'TD', 'BJ', 'AT&T', 'IBM', 'YMCA', 'HUD', 'MHC', 'QOZB', 'QOF', 'SPE', 'ULC']);

/** "ACME REALTY LLC" -> "Acme Realty LLC". Mixed-case names are left alone. */
export function prettyName(value) {
    const v = clean(value);
    if (!v) return null;
    if (v !== v.toUpperCase()) return v;
    return v.toLowerCase().replace(/[a-z0-9&'.]+/g, (w) => {
        const bare = w.replace(/\./g, '').toUpperCase();
        if (KEEP_UPPER.has(bare)) return w.toUpperCase();
        if (/^[a-z]&[a-z]$/.test(w)) return w.toUpperCase();
        if (/^\d+(st|nd|rd|th)$/.test(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
    });
}

/** "123 MAIN ST" -> "123 Main St". */
export const prettyAddress = prettyName;

/** Lowercase owner name without punctuation or legal suffixes, for grouping. */
export function ownerKey(value) {
    if (!value) return '';
    return String(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bc\/o\b.*$/, ' ')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\b(inc|incorporated|llc|l l c|ltd|limited|co|corp|corporation|company|the|lp|l p|llp|plc)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** "123 N. Main Street, Unit 4" -> "123 n main st" for matching. */
export function addressKey(value) {
    if (!value) return '';
    return String(value)
        .toLowerCase()
        .replace(/[.,#]/g, ' ')
        .replace(/\b(street)\b/g, 'st')
        .replace(/\b(avenue)\b/g, 'ave')
        .replace(/\b(road)\b/g, 'rd')
        .replace(/\b(boulevard)\b/g, 'blvd')
        .replace(/\b(drive)\b/g, 'dr')
        .replace(/\b(north)\b/g, 'n')
        .replace(/\b(south)\b/g, 's')
        .replace(/\b(east)\b/g, 'e')
        .replace(/\b(west)\b/g, 'w')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Owner names
// ---------------------------------------------------------------------------

// Words that show an owner is an organisation rather than a person.
const ENTITY_WORD = /\b(l\.?\s?l\.?\s?c|l\s?p|mills?|transportation|investmnt|grade|net lease|council|museum|project|friends|residences|svcs|techn\w*|preservation|hdfc|anstalt|prprts\w*|parking|garage|dst|trust co|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|l\.?p|llp|lllp|plc|pllc|pc|n\.?a|reit|trust co|fund|funds|partners|partnership|ptnrs|ptnr|ptrs|assoc|associates|association|assn|holdings?|hldgs|properties|property|prop|props|realty|real estate|investments?|investors?|invest|inv|development|developers?|dev|devel|capital|equities|equity|assets|ventures?|enterprises?|group|management|mgmt|partnership|owner|owners|bank|bancorp|financial|insurance|hospital|healthcare|health|medical|university|college|school|church|ministries|diocese|temple|synagogue|mosque|congregation|foundation|institute|society|club|lodge|authority|housing|apartments|apts|plaza|center|centre|mall|tower|towers|building|bldg|office|offices|industrial|industries|manufacturing|mfg|warehouse|storage|hotel|hotels|motel|inn|restaurants?|stores?|markets?|motors|auto|automotive|oil|gas|energy|electric|power|utility|utilities|railroad|railway|rr|transit|communications|telephone|cellular|wireless|towers|systems|services|service|solutions|international|intl|national|america|american|us|usa|united|county|city|town|township|village|borough|state|commonwealth|federal|government|dept|department|board|district|commission|agency|redevelopment|nominee|condominium|condo|homeowners|hoa|cooperative|coop|co-op|operating|leasing|lessee|landlord|portfolio|acquisitions?|venture|jv|spe|qozb|mhc|land|lands|estates?|farms?|ranch|sons|brothers|bros|family limited|lp\d*|\d+)\b/i;

// Personal trusts and estates: a person's name plus one of these words.
const PERSONAL_TRUST = /\b(revocable|irrevocable|living|family|rev|irrev|liv|declaration|decl|life estate|estate of|est of|heirs|deceased|dec'd|trustees?|trs|tr|tstee|ttee|et al|etal|et ux|etux|h\/w|husband|wife|jtros|jt ten|tenants)\b/i;

// Words that make a trust a business vehicle (common in Massachusetts).
const BUSINESS_TRUST = /\b(realty|nominee|business|investment|land|property|properties|real estate|condominium|condo|commercial|development|holdings?|associates|management|enterprises|venture|portfolio|reit|office|plaza|center|building|industrial)\b/i;

const GOVERNMENT = /\b(district of columbia|dc government|city of|town of|county of|village of|township of|borough of|state of|commonwealth of|united states|u\.?s\.? government|federal government|general services admin|government|county commissioners|board of (education|commissioners|trustees|supervisors|selectmen)|housing authority|redevelopment authority|port authority|transit authority|turnpike authority|transportation authority|water authority|sewer (district|commission|authority)|school district|public schools|board of education|department of|dept of|mbta|state university|community college|land bank|state prop\w*|parks? (and|&) rec|conservation commission|regional planning|airport authority|economic development corp|city & county)\b|^(city|town|county|state|village|township|borough|commonwealth) of\b/i;

const RELIGIOUS = /\b(church|chapel|ministr(y|ies)|diocese|archdiocese|parish|temple|synagogue|mosque|islamic|congregation|baptist|methodist|lutheran|presbyterian|episcopal|catholic|evangelical|pentecostal|assembly of god|jehovah|kingdom hall|christian (center|fellowship)|bishop|roman cath|rcab|cathedral)\b/i;

const NONPROFIT = /\b(university|college|school|academy|hospital|medical center|ymca|ywca|boys (and|&) girls|salvation army|habitat for humanity|goodwill|foundation|charit|non.?profit|museum|library|historical society|land trust|conservancy|audubon|scouts?|veterans of foreign|american legion|fraternal|elks|moose|masonic|knights of columbus)\b/i;

// Common US first names, used to spot a person's name with no business word.
const FIRST_NAMES = new Set(`james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle ethan walter noah jeremy christian keith roger terry gerald harold sean austin carl arthur lawrence dylan jesse jordan bryan billy joe bruce gabriel logan albert willie alan juan wayne elijah randy roy vincent ralph eugene russell bobby mason philip louis luke ben jim jimmy tom tim mike bill bob dave dan doug greg jeff jon ken matt nick pat rick ron steve ted tony chris curt curtis dale dean duane earl gene glenn howard jay jerome joel lee leon lloyd marvin mitchell neil norman phil rodney ross shane todd travis troy vernon warren wesley mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori`.split(' '));

/** True when a name looks like one or two people ("SMITH JOHN A", "JOHN & MARY SMITH"). */
export function looksLikePerson(name) {
    const v = clean(name);
    if (!v) return false;
    if (ENTITY_WORD.test(v)) return false;
    const words = v.replace(/[.,&/+;]/g, ' ').replace(/\band\b/gi, ' ').split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 7) return false;
    if (!words.every((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w))) return false;
    // Two to seven plain words with no business word: almost always people
    // on assessor rolls ("SMITH JOHN A", "LEE KIM KWONG").
    return words.length >= 2 || FIRST_NAMES.has(words[0].toLowerCase());
}

/**
 * What kind of owner a name is:
 *   company       an LLC, corporation, partnership, REIT, business trust...
 *   government    city, county, state, federal, authorities, school districts
 *   religious     churches and other places of worship
 *   nonprofit     universities, hospitals with nonprofit names, foundations...
 *   person        an individual or a personal trust (never output)
 *   unknown       no name
 */
// Legal forms used by for-profit property owners. A name with one of these is
// a company even when it also contains "School Street" or "Church Road".
const COMMERCIAL_FORM = /\b(l\.?\s?l\.?\s?c|l\.?p|llp|lllp|limited partnership|limited part|ltd partnership|realty|rlty|nominee|properties|holdings?|hldgs|associates|partners|reit|ventures?|investors?|investments?|development|capital|equities|enterprises?|owners?|apartments?|apts?)\b/i;
const PERSON_TRUSTEE = /\b(trustees?|trs|tr|ttee|tstee|trustee of)\b/i;
const STRONG_LEGAL_FORM = /\b(inc|incorporated|corp|corporation|company|co|bank|trust co|n\.?a)\b/i;

export function ownerType(name) {
    const v = clean(String(name ?? '').replace(/^(c\/o|attn:?)\s+/i, ''));
    if (!v || /^(unavailable|unknown|not available|none|owner unknown|unknown owner|unavailable owner|n\/a|same|record owner)\b/i.test(v)) return 'unknown';
    if (COMMERCIAL_FORM.test(v) && !GOVERNMENT.test(v.replace(COMMERCIAL_FORM, ' ').replace(/\b(turnpike|highway|road|rd|street|st|avenue|ave)\b/gi, ' '))) return 'company';
    if (GOVERNMENT.test(v)) return 'government';
    // "LEAHY DAVID H TRUSTEE", "JONES JOHN E JR TR": a person acting as trustee.
    if (PERSON_TRUSTEE.test(v) && !STRONG_LEGAL_FORM.test(v) && !BUSINESS_TRUST.test(v) && !NONPROFIT.test(v) && !RELIGIOUS.test(v)) return 'person';
    // Two or more "LAST, FIRST" names joined with ";" are people.
    if (/;/.test(v) && v.split(';').every((part) => looksLikePerson(part) || /^[A-Za-z'-]+,\s*[A-Za-z'. -]+$/.test(part.trim()))) return 'person';
    if (/\btrust\b|\btr\b|\btrs\b|\btrst\b|\bestate\b/i.test(v) && !BUSINESS_TRUST.test(v)) {
        // "SMITH FAMILY TRUST", "JOHN SMITH REVOCABLE TRUST", "ESTATE OF ..."
        const stripped = v.replace(/\b(trust|tr|trs|trst|estate)\b/gi, ' ');
        if (PERSONAL_TRUST.test(v) || looksLikePerson(stripped) || !ENTITY_WORD.test(stripped)) return 'person';
    }
    if (PERSONAL_TRUST.test(v) && !ENTITY_WORD.test(v.replace(PERSONAL_TRUST, ' '))) return 'person';
    if (looksLikePerson(v)) return 'person';
    if (/\b(hospital|university|medical center|health sciences)\b/i.test(v)) return 'nonprofit';
    if (RELIGIOUS.test(v)) return 'religious';
    if (NONPROFIT.test(v)) return 'nonprofit';
    return 'company';
}

/**
 * A second owner or care-of line is kept only when it is an organisation.
 * Returns the cleaned name or null.
 */
export function businessNameOrNull(name) {
    let v = clean(name);
    if (!v) return null;
    v = v.replace(/^(c\/o|attn:?|attention:?|%)\s*/i, '').trim();
    if (!v) return null;
    const t = ownerType(v);
    return t === 'person' || t === 'unknown' ? null : v;
}

/** Drops "Attn: Jane Doe," style lines from a mailing street, which can name a person. */
export function cleanMailStreet(value) {
    const v = clean(value);
    if (!v) return null;
    const out = v.replace(/^(attn|attention|atten)\b[:.]?\s*[^,]*,?\s*/i, '').trim();
    return out || null;
}
