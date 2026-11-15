// Turns each assessor's land-use code or description into one standard
// property type, so "COM/ OFFICE BLDG", "General Office Buildings", NYC
// building class O4 and Ohio class 447 all become `office`.

export const PROPERTY_TYPES = {
    office: 'Office buildings',
    medical_office: 'Medical offices & clinics',
    retail: 'Retail stores & service shops',
    shopping_center: 'Shopping centers, malls & big-box stores',
    restaurant: 'Restaurants, bars & fast food',
    hotel: 'Hotels & motels',
    multifamily: 'Apartment buildings (multifamily)',
    mixed_use: 'Mixed-use (commercial + residential)',
    industrial: 'Industrial & manufacturing',
    warehouse: 'Warehouses & distribution',
    self_storage: 'Self-storage',
    auto: 'Auto dealers, repair, gas stations & car washes',
    parking: 'Parking garages & lots',
    healthcare: 'Hospitals, nursing homes & senior living',
    bank: 'Banks',
    entertainment: 'Recreation, entertainment & clubs',
    other_commercial: 'Other / unspecified commercial',
    vacant_land: 'Vacant commercial & industrial land',
};
export const PROPERTY_TYPE_IDS = Object.keys(PROPERTY_TYPES);

// Not commercial real estate: dropped before any other rule runs.
const NOT_COMMERCIAL = /\b(single.?fam\w*|sing fam|sfr|sfd|s\/f|1.?fam(ily)?|one.?family|two.?fam\w*|2.?fam\w*|three.?fam\w*|3.?fam(ily)?|duplex|triplex|townhouse|town house|row house|semi.?detached|res(idential)? condo\w*|condominium (unit|res)|mobile home(?! park)|manufactured home|agricult\w*|farm(land)?|forest|timber|woodland|orchard|pasture|crop|cemetery|cemeteries|church\w*|relig\w*|worship|schools?|college|universit\w*|exempt\w*|exmpt|gov(ernmen)?t\w*|municipal|county prop|state prop|federal|public (service|school|land|utility land)|right.?of.?way|\brow\b|roads?|railroad right|water ?(body|area)|wetland|open space|conservation|chapter 61|rural|seasonal|recreational res|lake ?shore|waterfront|ocean|homestead|residential (lake|single|unit|land|improved|dwelling|vacant)|resident land|res land|res dwelling|res\b|resid\w*.?garage|garage.?(-|\s)*resid\w*|garage.?multifam\w*)\b/i;

const RULES = [
    ['self_storage', /mini.?(ware|stor|whse)|self.?stor|storage units?|storage condo/i],
    ['mixed_use', /(mixed|multi).?use.*(comm|retail|office|store|indus)|(comm|retail|office|store|shop)\w*.*(apts?|apart\w*|dwell\w*|resid\w*)\b|(apts?|apart\w*|dwell\w*|resid\w*).*(store|retail|office|comm\w*)|over.?walk.?up|store with dwelling|stores?\/apt|primarily commercial/i],
    ['healthcare', /nursing|hospital|assisted|elderly|senior (liv|hous|cent)|convalesc|home for (the )?aged|health care fac|rehab\w* (cent|fac)|hospice|life care|sanitar|congregate care|retirement (home|comm)/i],
    ['medical_office', /medical|clinic|dental|veterin|surgery|surgical|dialysis|urgent care|physician/i],
    ['hotel', /hotel|motel|\binns?\b|lodging|tourist|resort|bed.?(and|&).?breakfast|\bb ?& ?b\b/i],
    ['multifamily', /apart\w*|\bapts?\b|multi.?fam\w*|multifam\w*|multiple units|garden apt|\d+\+? ?units|\d+ or more (rental )?units|over \d+ units|rooming|boarding|dormit|fraterni|sororit|lihtc|subs\w* hous|low.?inc\w* (hous|rental)|affordable hous|housing|co.?op(erative)? (vert|horiz|apt)|walk.?up|elevator|congregate housing/i],
    ['auto', /\bauto\w*|car wash|carwash|gas (station|sta)|service station|fuel (serv|sta)|vehicle|dealer\w*|car sales|used car|truck.*(sales|service)|tire|garage.?veh|commercial garage|auto repair|body shop|equip\w* sales/i],
    ['parking', /parking|park(ing)? gar|parking deck|\bgarages?\b/i],
    ['warehouse', /warehouse|whse|wrhs|distribut\w*|truck term\w*|terminal|storage|cold stor|freight|logistic|flex/i],
    ['industrial', /indust\w*|\bind\b|manuf\w*|mfg|factory|factories|plant|foundr\w*|process\w*|laborator|research|r ?& ?d|machine|tool ?(&|and) ?die|mill\b|mills|quarr\w*|mines?\b|mining|gravel|lumber|tank farm|bulk (oil|stor)|data cent\w*|utility|utilities|electric|power plant|substation|telephone|telecom|cell (site|tower)|radio|tv station|pier|wharf|dock/i],
    ['restaurant', /restaur\w*|resturant|fast.?food|food serv\w*|drive.?(in|thru|through)|cafeteria|\bbars?\b|tavern|night.?club|carry.?out|diner|eating|drinking|pizza/i],
    ['bank', /\bbanks?\b|savings (and|&) loan|financial inst|credit union/i],
    ['shopping_center', /shopping|shop ctrs?|shop cntr|mall\b|plaza|strip (cent|shop|ctr|retail)|department stores?|dept stores?|discount stores?|super ?markets?|grocery|big.?box|regional (shop|cent)|community shop|neighborhood shop|outlet/i],
    ['office', /office|\boff\b|off bldg|prof\w* (bldg|bld|bl|build\w*|serv\w*)|\bprof bldg|exec\w* (suite|cent)|corporate|headquarter/i],
    ['entertainment', /theat\w*|cinema|bowling|golf|amusement|recreat\w*|\bclubs?\b|fitness|health spa|spa\b|sports|arena|stadium|camp\w*|marina|skating|ice rink|swim\w*|tennis|racquet|entertain\w*|lodge hall|museum|gallery|casino|race ?track|country club|bowl/i],
    ['retail', /retail|stores?\b|\bshops?\b|sales|showroom|drug|pharmac\w*|convenien\w*|barber|beauty|salon|dry clean\w*|laundr\w*|funeral|mortuar\w*|day.?care|child care|kennel|nursery|garden (center|sales)|service (bldg|build\w*|shop)|commercial service|com services|\bcomm? serv/i],
];

const VACANT = /vacant|undevelop\w*|unimproved|land only|\bland\b|\blot\b|acreage|developable|potential/i;
const BUILT = /build\w*|bldg|improv\w*|struct\w*|with (bldg|imp)/i;
const COMMERCIAL_WORD = /comm\w*|\bcom\b|\bc\b|business|special purpose|specific purpose|non.?resid\w*|income|investment|other (commercial|structures)/i;
const INDUSTRIAL_WORD = /indust\w*|\bind\b|\bi\b|manuf\w*/i;

/**
 * Standard property type for a free-text land-use description, or null when
 * the property is not commercial real estate (homes, farms, churches, public
 * land, vacant residential land...).
 */
export function classifyText(description) {
    const d = String(description ?? '').replace(/\s+/g, ' ').trim();
    if (!d) return null;
    const isVacant = VACANT.test(d) && !BUILT.test(d);
    if (isVacant) {
        if (/resid|\bres\b|sfr|single|dwelling|homesite|rural|agri|farm|forest|seasonal/i.test(d)) return null;
        if (COMMERCIAL_WORD.test(d) || INDUSTRIAL_WORD.test(d) || /vacant.?(true|false|permit|zoning|unimproved parking)/i.test(d)) return 'vacant_land';
    }
    // "Exempt Commercial", "Commercial / church" and the like stay out.
    if (NOT_COMMERCIAL.test(d)) {
        // ...unless the description clearly names a commercial use as well,
        // e.g. "Apartment 4 or more units", "Residential - Apartment (Walkup)".
        const rescued = /apart|\bapts?\b|multi.?fam|mixed.?use.*comm|primarily commercial|nursing|hotel|motel|elevator|walk.?up|\d+ ?(\+|or more) ?(rental )?units|over \d+ units/i.test(d)
            && !/exempt|exmpt|condo|relig|church|gov|school|universit|college/i.test(d)
            && !/primarily (residential|agri|forest|recreation)/i.test(d);
        if (!rescued) return null;
    }
    for (const [type, re] of RULES) if (re.test(d)) return type;
    if (isVacant) return null;
    if (INDUSTRIAL_WORD.test(d)) return 'industrial';
    if (COMMERCIAL_WORD.test(d)) return 'other_commercial';
    return null;
}

// ---------------------------------------------------------------------------
// Code-based systems
// ---------------------------------------------------------------------------

/**
 * Massachusetts DOR property type codes (first three digits of USE_CODE).
 * See the Massachusetts "Property Type Classification Codes" guide.
 */
export function classifyMassachusetts(code, description) {
    const c = String(code ?? '').replace(/\D/g, '').slice(0, 3);
    if (/^0\d\d$/.test(c)) {
        // Mixed use: the two digits are the classes involved, first = main use.
        const [a, b] = [c[1], c[2]];
        if (a === '3' || b === '3' || a === '4' || b === '4') return a === '4' ? 'industrial' : 'mixed_use';
        return null;
    }
    if (c === '111' || c === '112' || c === '121' || c === '125') return 'multifamily';
    if (/^1/.test(c)) return null;
    const exact = {
        300: 'hotel', 301: 'hotel', 302: 'hotel', 303: 'healthcare', 304: 'healthcare', 305: 'healthcare',
        310: 'industrial', 311: 'industrial', 312: 'warehouse', 313: 'warehouse', 314: 'warehouse', 315: 'warehouse', 316: 'warehouse', 317: 'warehouse', 318: 'warehouse', 319: 'warehouse',
        320: 'retail', 321: 'retail', 322: 'shopping_center', 323: 'shopping_center', 324: 'shopping_center', 325: 'retail', 326: 'restaurant', 327: 'retail', 328: 'retail', 329: 'retail',
        330: 'auto', 331: 'auto', 332: 'auto', 333: 'auto', 334: 'auto', 335: 'auto', 336: 'parking', 337: 'parking', 338: 'parking', 339: 'auto',
        340: 'office', 341: 'bank', 342: 'medical_office', 343: 'office', 344: 'office', 345: 'office', 346: 'office', 347: 'office', 348: 'office', 349: 'office',
        350: 'other_commercial', 351: 'other_commercial', 352: 'retail', 353: 'entertainment', 354: 'other_commercial', 355: 'retail', 356: 'other_commercial', 357: 'other_commercial', 358: 'other_commercial', 359: 'other_commercial',
        390: 'vacant_land', 391: 'vacant_land', 392: 'vacant_land', 393: 'vacant_land',
        400: 'industrial', 401: 'warehouse', 402: 'office', 403: 'industrial', 404: 'industrial', 405: 'industrial', 406: 'industrial', 407: 'industrial', 408: 'industrial', 409: 'industrial',
        440: 'vacant_land', 441: 'vacant_land', 442: 'vacant_land', 443: 'vacant_land',
    };
    if (exact[c]) return exact[c];
    if (/^3[67]/.test(c) || /^38/.test(c)) return 'entertainment';
    if (/^4[1-3]/.test(c)) return 'industrial';
    if (/^3/.test(c)) return classifyText(description) ?? 'other_commercial';
    if (/^4/.test(c)) return classifyText(description) ?? 'industrial';
    return null; // 2xx open land, 5xx personal property, 6-8xx chapter land, 9xx exempt
}

/** Ohio Department of Taxation land-use class codes (300s industrial, 400s commercial). */
export function classifyOhio(code, description) {
    const c = Number(String(code ?? '').slice(0, 3));
    if (!(c >= 300 && c < 500)) return null;
    if (c === 300 || c === 400) return 'vacant_land';
    if (c >= 401 && c <= 403) return 'multifamily';
    if (c >= 404 && c <= 406) return 'mixed_use';
    if (c === 431 || c === 432) return 'mixed_use';
    if (c === 481) return 'self_storage';
    const text = classifyText(description);
    if (text) return text;
    return c < 400 ? 'industrial' : 'other_commercial';
}

// NYC Department of Finance building classes (PLUTO bldgclass).
const NYC_CLASS_DESC = {
    C: 'Walk-up apartments', D: 'Elevator apartments', E: 'Warehouses', F: 'Factory & industrial buildings',
    G: 'Garages & gas stations', H: 'Hotels', I: 'Hospitals & health facilities', J: 'Theatres',
    K: 'Store buildings', L: 'Loft buildings', N: 'Asylums & homes', O: 'Office buildings',
    P: 'Places of public assembly', Q: 'Outdoor recreation', S: 'Mixed residence & stores',
    T: 'Transportation facilities', U: 'Utility properties', V: 'Vacant land', Z: 'Miscellaneous',
};
const NYC_EXACT = {
    C0: null, C6: null, C8: null, // three families, co-ops (owned by unit holders), condos
    D0: null, D4: null, // co-ops
    G0: null, G1: 'parking', G2: 'auto', G3: 'auto', G4: 'auto', G5: 'auto', G6: 'parking', G7: 'parking', G8: 'auto', G9: 'parking', GU: 'auto', GW: 'auto',
    H1: 'hotel', H2: 'hotel', H3: 'hotel', H4: 'hotel', H5: 'hotel', H6: 'hotel', H7: 'hotel', H8: 'multifamily', HB: 'hotel', HH: 'hotel', HR: 'multifamily', HS: 'hotel',
    I1: 'healthcare', I2: 'healthcare', I3: 'healthcare', I4: 'multifamily', I5: 'medical_office', I6: 'healthcare', I7: 'healthcare', I9: 'healthcare',
    K1: 'retail', K2: 'shopping_center', K3: 'shopping_center', K4: 'retail', K5: 'restaurant', K6: 'shopping_center', K7: 'retail', K8: 'shopping_center', K9: 'retail',
    O1: 'office', O2: 'office', O3: 'office', O4: 'office', O5: 'office', O6: 'office', O7: 'office', O8: 'mixed_use', O9: 'office',
    V0: null, V1: 'vacant_land', V2: 'vacant_land', V3: 'vacant_land', V4: null, V5: null, V6: 'vacant_land', V7: null, V8: null, V9: 'vacant_land',
    Z0: 'entertainment', Z1: null, Z2: null, Z3: 'other_commercial', Z4: null, Z5: null, Z7: null, Z8: null, Z9: 'other_commercial',
};
const NYC_LETTER = { C: 'multifamily', D: 'multifamily', E: 'warehouse', F: 'industrial', J: 'entertainment', L: 'office', N: 'healthcare', P: 'entertainment', Q: 'entertainment', S: 'mixed_use', T: 'other_commercial', U: 'industrial', RB: 'office', RK: 'retail', RH: 'hotel' };

export function nycClassDescription(code) {
    const c = String(code ?? '').toUpperCase();
    return NYC_CLASS_DESC[c[0]] ? `${NYC_CLASS_DESC[c[0]]} (${c})` : c || null;
}

export function classifyNyc(code) {
    const c = String(code ?? '').toUpperCase().trim();
    if (!c) return null;
    if (c in NYC_EXACT) return NYC_EXACT[c];
    if (c === 'S0' || c === 'S1' || c === 'S2') return 'mixed_use';
    if (c === 'E7') return 'self_storage';
    return NYC_LETTER[c[0]] ?? null; // A/B homes, M religious, R condos, W education, Y government
}

/** Wisconsin statewide parcels: PROPCLASS 2 = commercial, 3 = manufacturing. */
export function classifyWisconsin(propclass) {
    const classes = String(propclass ?? '').split(/[,\s]+/);
    if (classes.includes('3')) return 'industrial';
    if (classes.includes('2')) return 'other_commercial';
    return null;
}
