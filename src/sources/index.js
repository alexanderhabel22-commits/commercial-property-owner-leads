// Every public parcel source the Actor reads, and how each one's fields map to
// the shared record shape. Add a source by adding an entry to SOURCES.

import { queryLayer, featurePoint } from './arcgis.js';
import { fetchJson } from '../http.js';
import { classifyText, classifyMassachusetts, classifyOhio, classifyNyc, classifyWisconsin, nycClassDescription } from '../classify.js';
import { clean, num, year, zip5, isoDate, stateAbbr } from '../normalize.js';

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;
const upperIn = (field, values) => `UPPER(${field}) IN (${values.map((v) => sqlText(v.toUpperCase())).join(',')})`;

// Words that a commercial land-use description usually contains. Used to
// skip homes on the server for sources that only have free-text land uses.
const COMMERCIAL_LIKE = ['COM', 'IND', 'OFF', 'APT', 'APART', 'RETAIL', 'STORE', 'SHOP', 'WARE', 'WHSE', 'HOTEL', 'MOTEL', 'INN', 'MIX', 'FACT', 'MFG', 'MANUF', 'REST', 'BANK', 'GARAGE', 'PARK', 'MEDIC', 'NURS', 'MALL', 'PLAZA', 'AUTO', 'GAS', 'STOR', 'PROF', 'BUS', 'CLUB', 'BOWL', 'GOLF', 'THEAT', 'MULTI', 'UNITS', 'HOSP', 'CLINIC', 'DEALER', 'SERV', 'LAB', 'DISTRIB', 'TERMINAL', 'FOOD', 'DAY CARE', 'FUNERAL', 'SALES', 'CAR WASH', 'HOUSING', 'ELDERLY', 'ASSISTED', 'MARINA', 'RECREA', 'LODG', 'FLEX', 'TRUCK', 'UTIL', 'VACANT', 'LAND'];
const textPrefilter = (field, extraExact = []) => `(${[
    ...COMMERCIAL_LIKE.map((w) => `UPPER(${field}) LIKE '%${w}%'`),
    ...extraExact.map((v) => `UPPER(${field}) = ${sqlText(v)}`),
].join(' OR ')})`;

// Narrower server-side words per property type, used when the user picked
// specific types and the source only has free-text land uses. The full
// classifier still runs on every record afterwards.
const TYPE_WORDS = {
    office: ['OFF', 'PROF', 'EXEC', 'CORPORATE'],
    medical_office: ['MEDIC', 'CLINIC', 'DENTAL', 'VETERIN', 'SURG', 'DIALYSIS'],
    retail: ['RETAIL', 'STORE', 'SHOP', 'SALES', 'DRUG', 'PHARM', 'CONVEN', 'BARBER', 'BEAUTY', 'SALON', 'CLEAN', 'LAUNDR', 'FUNERAL', 'DAY CARE', 'CHILD', 'KENNEL', 'NURSERY', 'SERV', 'SHOWROOM'],
    shopping_center: ['SHOP', 'MALL', 'PLAZA', 'STRIP', 'DEPART', 'DISCOUNT', 'MARKET', 'GROCERY', 'BIG BOX', 'OUTLET', 'CENTER', 'CTR'],
    restaurant: ['REST', 'FOOD', 'DRIVE', 'CAFE', 'BAR', 'TAVERN', 'CLUB', 'CARRY', 'DINER', 'EATING', 'PIZZA'],
    hotel: ['HOTEL', 'MOTEL', 'INN', 'LODG', 'TOURIST', 'RESORT', 'BREAKFAST'],
    multifamily: ['APART', 'APT', 'MULTI', 'UNITS', 'ROOMING', 'BOARDING', 'DORM', 'HOUSING', 'LOW INC', 'WALK', 'ELEVATOR', 'GARDEN', 'CO-OP', 'COOP'],
    mixed_use: ['MIX', 'MULTI', 'APT', 'APART', 'DWELL', 'RESID', 'OVER'],
    industrial: ['IND', 'MANUF', 'MFG', 'FACT', 'PLANT', 'FOUNDR', 'PROCESS', 'LAB', 'RESEARCH', 'MACHINE', 'TOOL', 'MILL', 'QUARR', 'MINE', 'GRAVEL', 'LUMBER', 'TANK', 'BULK', 'DATA', 'UTIL', 'ELECTRIC', 'POWER', 'TELE', 'CELL', 'RADIO', 'PIER', 'WHARF', 'DOCK'],
    warehouse: ['WARE', 'WHSE', 'WRHS', 'DISTRIB', 'TERMINAL', 'STOR', 'FREIGHT', 'LOGISTIC', 'FLEX', 'TRUCK'],
    self_storage: ['MINI', 'SELF', 'STOR'],
    auto: ['AUTO', 'CAR', 'GAS', 'SERVICE STA', 'FUEL', 'VEHICLE', 'DEALER', 'TRUCK', 'TIRE', 'GARAGE', 'BODY', 'EQUIP'],
    parking: ['PARK', 'GARAGE'],
    healthcare: ['NURS', 'HOSP', 'ASSISTED', 'ELDERLY', 'SENIOR', 'CONVALES', 'AGED', 'HEALTH', 'REHAB', 'HOSPICE', 'LIFE CARE', 'CONGREGATE', 'RETIRE'],
    bank: ['BANK', 'SAVINGS', 'FINANC', 'CREDIT'],
    entertainment: ['THEAT', 'CINEMA', 'BOWL', 'GOLF', 'AMUSE', 'RECREA', 'CLUB', 'FITNESS', 'SPA', 'SPORT', 'ARENA', 'STADIUM', 'CAMP', 'MARINA', 'SKAT', 'RINK', 'SWIM', 'TENNIS', 'RACQ', 'ENTERTAIN', 'LODGE', 'MUSEUM', 'GALLER', 'CASINO', 'TRACK'],
    vacant_land: ['VACANT', 'UNDEV', 'UNIMP', 'LAND', 'LOT', 'ACRE', 'DEVELOP', 'POTENTIAL'],
};

/** Prefilter for the chosen property types, or the general one when "other" or all types are wanted. */
export function typePrefilter(field, propertyTypes, extraExact = []) {
    if (!propertyTypes?.length || propertyTypes.includes('other_commercial')) return textPrefilter(field, extraExact);
    const words = [...new Set(propertyTypes.flatMap((t) => TYPE_WORDS[t] ?? []))];
    // Single-letter county codes ("I" = industrial) only matter for industrial.
    const exact = propertyTypes.includes('industrial') ? extraExact.filter((v) => v === 'I') : [];
    return `(${[...words.map((w) => `UPPER(${field}) LIKE '%${w}%'`), ...exact.map((v) => `UPPER(${field}) = ${sqlText(v)}`)].join(' OR ')})`;
}

/** Splits "123 MAIN ST SPRINGFIELD MA 01103-1234" into its parts when it ends in "ST ZIP". */
export function splitMailingLine(line) {
    const v = clean(line);
    if (!v) return { street: null, city: null, state: null, zip: null };
    const m = v.match(/^(.*?)[,\s]+([A-Z]{2})[,\s]+(\d{5})(?:-?\d{4})?$/i);
    if (!m || !stateAbbr(m[2])) return { street: v, city: null, state: null, zip: zip5(v) };
    let street = m[1].trim().replace(/,$/, '');
    let city = null;
    const comma = street.lastIndexOf(',');
    if (comma > 0) {
        city = street.slice(comma + 1).trim() || null;
        street = street.slice(0, comma).trim();
    }
    return { street, city, state: m[2].toUpperCase(), zip: m[3] };
}

/** Splits "LONDON, OH 43140" or "WASHINGTON DC 20001-1234". */
export function splitCityStateZip(line) {
    const v = clean(line);
    if (!v) return { city: null, state: null, zip: null };
    const m = v.match(/^(.*?)[,\s]+([A-Z]{2})\.?(?:[,\s]+(\d{5})(?:-?\d{4})?)?$/i);
    if (!m || !stateAbbr(m[2])) return { city: v, state: null, zip: zip5(v) };
    return { city: m[1].trim().replace(/,$/, '') || null, state: m[2].toUpperCase(), zip: m[3] ?? null };
}

const acresFrom = (value, units) => {
    const n = num(value);
    if (!n) return null;
    return /sq|sf|feet/i.test(units ?? '') ? Math.round((n / 43_560) * 1000) / 1000 : Math.round(n * 1000) / 1000;
};

/** Base record with every field present, so all sources output the same shape. */
export function blankRecord(source) {
    return {
        source: source.id,
        source_name: source.label,
        source_url: source.homepage,
        parcel_id: null,
        property_address: null,
        city: null,
        county: null,
        state: source.state,
        zip: null,
        _point: null,
        land_use_code: null,
        land_use_description: null,
        property_type: null,
        building_sqft: null,
        lot_acres: null,
        year_built: null,
        floors: null,
        units: null,
        value_usd: null,
        value_type: source.valueType,
        land_value_usd: null,
        building_value_usd: null,
        last_sale_date: null,
        last_sale_price_usd: null,
        owner_raw: null,
        owner2_raw: null,
        care_of_raw: null,
        mail_street: null,
        mail_city: null,
        mail_state: null,
        mail_zip: null,
        zoning: null,
    };
}

// ---------------------------------------------------------------------------
// ArcGIS sources
// ---------------------------------------------------------------------------

const MA = {
    id: 'MA',
    label: 'MassGIS statewide property tax parcels',
    state: 'MA',
    area: 'Massachusetts (statewide, all 351 cities and towns)',
    homepage: 'https://www.mass.gov/info-details/massgis-data-property-tax-parcels',
    kind: 'arcgis',
    url: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0',
    valueType: 'assessed (full market value)',
    baseWhere: "(USE_CODE LIKE '0%' OR USE_CODE LIKE '111%' OR USE_CODE LIKE '112%' OR USE_CODE LIKE '121%' OR USE_CODE LIKE '125%' OR USE_CODE LIKE '3%' OR USE_CODE LIKE '4%')",
    valueField: 'TOTAL_VAL',
    cityWhere: (cities) => upperIn('CITY', cities),
    zipWhere: (zips) => `ZIP IN (${zips.map(sqlText).join(',')})`,
    map(a, point) {
        const r = blankRecord(this);
        Object.assign(r, {
            parcel_id: clean(a.LOC_ID) ?? clean(a.MAP_PAR_ID),
            property_address: clean(a.SITE_ADDR) ?? clean(a.LOCATION),
            city: clean(a.CITY),
            zip: zip5(a.ZIP),
            _point: point,
            land_use_code: clean(a.USE_CODE),
            land_use_description: clean(a.USE_DESC),
            property_type: classifyMassachusetts(a.USE_CODE, a.USE_DESC),
            building_sqft: num(a.BLD_AREA),
            lot_acres: acresFrom(a.LOT_SIZE, a.LOT_UNITS),
            year_built: year(a.YEAR_BUILT),
            floors: num(a.STORIES),
            units: num(a.UNITS),
            value_usd: num(a.TOTAL_VAL),
            land_value_usd: num(a.LAND_VAL),
            building_value_usd: num(a.BLDG_VAL),
            last_sale_date: isoDate(a.LS_DATE),
            last_sale_price_usd: num(a.LS_PRICE),
            owner_raw: clean(a.OWNER1),
            mail_street: clean(a.OWN_ADDR),
            mail_city: clean(a.OWN_CITY),
            mail_state: stateAbbr(a.OWN_STATE),
            mail_zip: zip5(a.OWN_ZIP),
            zoning: clean(a.ZONING),
        });
        return r;
    },
};

const CT = {
    id: 'CT',
    label: 'Connecticut statewide CAMA and parcel layer',
    state: 'CT',
    area: 'Connecticut (statewide, all 169 towns)',
    homepage: 'https://geodata.ct.gov/',
    kind: 'arcgis',
    url: 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_2025/FeatureServer/0',
    valueType: 'appraised (market value)',
    baseWhere: textPrefilter('State_Use_Description'),
    typeWhere: (types) => typePrefilter('State_Use_Description', types),
    // Connecticut assesses at 70% of appraised value.
    valueField: 'Assessed_Total',
    valueFieldFactor: 0.7,
    cityWhere: (cities) => `(${upperIn('Town_Name', cities)} OR ${upperIn('Property_City', cities)})`,
    zipWhere: (zips) => `Property_Zip IN (${zips.map(sqlText).join(',')})`,
    map(a, point) {
        const r = blankRecord(this);
        const appraised = (num(a.Appraised_Land) ?? 0) + (num(a.Appraised_Building) ?? 0) + (num(a.Appraised_Outbuilding) ?? 0);
        Object.assign(r, {
            parcel_id: clean(a.CAMA_Link) ?? clean(a.Parcel_ID),
            property_address: clean(a.Location_1) ?? clean(a.Location),
            city: clean(a.Property_City) ?? clean(a.Town_Name),
            county: null,
            zip: zip5(a.Property_Zip),
            _point: point,
            land_use_code: clean(a.State_Use),
            land_use_description: clean(a.State_Use_Description),
            property_type: classifyText(a.State_Use_Description),
            building_sqft: num(a.Living_Area) ?? num(a.Effective_Area),
            lot_acres: acresFrom(a.Land_Acres),
            year_built: year(a.AYB),
            value_usd: appraised || (num(a.Assessed_Total) ? Math.round(num(a.Assessed_Total) / 0.7) : null),
            land_value_usd: num(a.Appraised_Land),
            building_value_usd: num(a.Appraised_Building),
            last_sale_date: isoDate(a.Sale_Date),
            last_sale_price_usd: num(a.Sale_Price),
            owner_raw: clean(a.Owner),
            owner2_raw: clean(a.Co_Owner),
            mail_street: clean(a.Mailing_Address),
            mail_city: clean(a.Mailing_City),
            mail_state: stateAbbr(a.Mailing_State),
            mail_zip: zip5(a.Mailing_Zip),
            zoning: clean(a.Zone),
        });
        return r;
    },
};

const NC = {
    id: 'NC',
    label: 'NC OneMap statewide parcels',
    state: 'NC',
    area: 'North Carolina (statewide, all 100 counties)',
    homepage: 'https://www.nconemap.gov/pages/parcels',
    kind: 'arcgis',
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0',
    pointLayer: true,
    valueType: 'assessed (market value)',
    baseWhere: textPrefilter('parusedesc', ['C', 'I']),
    typeWhere: (types) => typePrefilter('parusedesc', types, ['C', 'I']),
    valueField: 'parval',
    cityWhere: (cities) => `(${upperIn('scity', cities)} OR ${cities.map((c) => `UPPER(siteadd) LIKE ${sqlText(`% ${c.toUpperCase()} NC%`)}`).join(' OR ')})`,
    zipWhere: (zips) => `szip IN (${zips.map(sqlText).join(',')})`,
    map(a, point) {
        const r = blankRecord(this);
        const city = clean(a.scity);
        let address = clean(a.siteadd);
        if (address && city) address = address.replace(new RegExp(`\\s+${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+NC$`, 'i'), '');
        else if (address) address = address.replace(/\s+NC$/i, '');
        const desc = clean(a.parusedesc);
        Object.assign(r, {
            parcel_id: clean(a.parno) ?? clean(a.altparno),
            property_address: address,
            city,
            county: clean(a.cntyname),
            zip: zip5(a.szip),
            _point: point,
            land_use_code: clean(a.parusecode),
            land_use_description: desc,
            property_type: classifyText(desc),
            year_built: year(a.structyear),
            lot_acres: acresFrom(a.gisacres),
            value_usd: num(a.parval),
            land_value_usd: num(a.landval),
            building_value_usd: num(a.improvval),
            last_sale_date: isoDate(a.saledate),
            owner_raw: clean(a.ownname),
            owner2_raw: clean(a.ownname2),
            mail_street: clean(a.mailadd)?.replace(/\s+\d{5}(-\d{4})?$/, '') ?? null,
            mail_city: clean(a.mcity),
            mail_state: stateAbbr(a.mstate),
            mail_zip: zip5(a.mzip),
        });
        return r;
    },
};

const WI = {
    id: 'WI',
    label: 'Wisconsin statewide parcel database (V12)',
    state: 'WI',
    area: 'Wisconsin (statewide, all 72 counties)',
    homepage: 'https://www.sco.wisc.edu/parcels/data/',
    kind: 'arcgis',
    url: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0',
    centroid: false,
    valueType: 'estimated fair market value',
    baseWhere: "(PROPCLASS LIKE '%2%' OR PROPCLASS LIKE '%3%')",
    valueField: 'ESTFMKVALUE',
    cityWhere: (cities) => upperIn('PLACENAME', cities.flatMap((c) => [c, `CITY OF ${c}`, `VILLAGE OF ${c}`, `TOWN OF ${c}`])),
    zipWhere: (zips) => `ZIPCODE IN (${zips.map(sqlText).join(',')})`,
    map(a) {
        const r = blankRecord(this);
        const mail = splitMailingLine(a.PSTLADRESS);
        const lat = Number(a.LATITUDE);
        const lon = Number(a.LONGITUDE);
        Object.assign(r, {
            parcel_id: clean(a.STATEID) ?? clean(a.PARCELID),
            property_address: clean(a.SITEADRESS),
            city: clean(a.PLACENAME)?.replace(/^(CITY|VILLAGE|TOWN) OF\s+/i, '') ?? null,
            county: clean(a.CONAME),
            zip: zip5(a.ZIPCODE),
            _point: Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? [lat, lon] : null,
            land_use_code: clean(a.PROPCLASS),
            land_use_description: String(a.PROPCLASS ?? '').includes('3') ? 'Manufacturing (class 3)' : 'Commercial (class 2)',
            property_type: classifyWisconsin(a.PROPCLASS),
            lot_acres: acresFrom(a.ASSDACRES) ?? acresFrom(a.GISACRES),
            value_usd: num(a.ESTFMKVALUE),
            land_value_usd: num(a.LNDVALUE),
            building_value_usd: num(a.IMPVALUE),
            owner_raw: clean(a.OWNERNME1),
            owner2_raw: clean(a.OWNERNME2),
            mail_street: mail.street,
            mail_city: mail.city,
            mail_state: mail.state,
            mail_zip: mail.zip,
        });
        return r;
    },
};

const MN = {
    id: 'MN',
    label: 'Minnesota open parcels (opt-in counties)',
    state: 'MN',
    area: 'Minnesota (counties that publish open parcel data, including Hennepin/Minneapolis, Ramsey/St. Paul, Dakota, Anoka, Washington)',
    homepage: 'https://gisdata.mn.gov/dataset/plan-parcels-open',
    kind: 'arcgis',
    url: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/0',
    valueType: 'estimated market value',
    baseWhere: textPrefilter('useclass1'),
    typeWhere: (types) => typePrefilter('useclass1', types),
    valueField: 'emv_total',
    cityWhere: (cities) => `(${upperIn('ctu_name', cities)} OR ${upperIn('postcomm', cities)})`,
    zipWhere: (zips) => `zip IN (${zips.map(sqlText).join(',')})`,
    map(a, point) {
        const r = blankRecord(this);
        const addrParts = [a.anumberpre, a.anumber, a.anumbersuf, a.st_pre_mod, a.st_pre_dir, a.st_pre_typ, a.st_pre_sep, a.st_name, a.st_pos_typ, a.st_pos_dir, a.st_pos_mod].map(clean).filter(Boolean);
        const unit = [a.sub_type1, a.sub_id1].map(clean).filter(Boolean).join(' ');
        let mailLines = [a.own_add_l1, a.own_add_l2, a.own_add_l3, a.own_add_l4].map(clean).filter(Boolean);
        if (!mailLines.length) mailLines = [a.tax_add_l1, a.tax_add_l2, a.tax_add_l3, a.tax_add_l4].map(clean).filter(Boolean);
        const last = splitCityStateZip(mailLines.at(-1));
        Object.assign(r, {
            parcel_id: clean(a.state_pin) ?? clean(a.county_pin),
            property_address: addrParts.length ? `${addrParts.join(' ')}${unit ? ` ${unit}` : ''}` : clean(a.landmark),
            city: clean(a.postcomm) ?? clean(a.ctu_name),
            county: clean(a.co_name),
            zip: zip5(a.zip),
            _point: point,
            land_use_code: clean(a.useclass1),
            land_use_description: [a.useclass1, a.useclass2].map(clean).filter(Boolean).join('; '),
            property_type: classifyText(a.useclass1) ?? classifyText(a.useclass2),
            building_sqft: num(a.fin_sq_ft),
            lot_acres: acresFrom(a.acres_deed) ?? acresFrom(a.acres_poly),
            year_built: year(a.year_built),
            units: num(a.num_units),
            value_usd: num(a.emv_total),
            land_value_usd: num(a.emv_land),
            building_value_usd: num(a.emv_bldg),
            last_sale_date: isoDate(a.sale_date),
            last_sale_price_usd: num(a.sale_value),
            owner_raw: clean(a.owner_name) ?? clean(a.tax_name),
            owner2_raw: clean(a.owner_more),
            mail_street: mailLines.length > 1 ? mailLines.slice(0, -1).join(', ') : null,
            mail_city: last.city,
            mail_state: last.state,
            mail_zip: last.zip,
        });
        return r;
    },
};

const DC = {
    id: 'DC',
    label: 'DC Office of Tax and Revenue owner polygons',
    state: 'DC',
    area: 'Washington, DC',
    homepage: 'https://opendata.dc.gov/datasets/owner-polygons-common-ownership-layer',
    kind: 'arcgis',
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/40',
    valueType: 'assessed (market value)',
    baseWhere: `(${textPrefilter('PROPTYPE')} OR UPPER(PROPTYPE) LIKE 'STORE%' OR UPPER(PROPTYPE) LIKE 'HOTEL%')`,
    valueField: 'ASSESSMENT',
    citySupported: (cities) => cities.some((c) => /^(washington|washington dc|dc|district of columbia)$/i.test(c)),
    cityWhere: () => '1=1',
    zipWhere: null,
    map(a, point) {
        const r = blankRecord(this);
        const mail = splitCityStateZip(a.CITYSTZIP);
        Object.assign(r, {
            parcel_id: clean(a.SSL),
            property_address: clean(a.PREMISEADD)?.replace(/\s+WASHINGTON\s+DC(\s+\d{5}(-\d{4})?)?$/i, '') ?? null,
            zip: zip5(a.PREMISEADD),
            city: 'Washington',
            county: 'District of Columbia',
            _point: point,
            land_use_code: clean(a.USECODE),
            land_use_description: clean(a.PROPTYPE),
            property_type: classifyText(a.PROPTYPE),
            lot_acres: acresFrom(a.LANDAREA, 'sqft'),
            value_usd: num(a.ASSESSMENT) ?? num(a.NEWTOTAL),
            land_value_usd: num(a.NEWLAND),
            building_value_usd: num(a.NEWIMPR),
            last_sale_date: isoDate(a.SALEDATE),
            last_sale_price_usd: num(a.SALEPRICE),
            owner_raw: clean(a.OWNERNAME),
            owner2_raw: clean(a.OWNNAME2),
            care_of_raw: clean(a.CAREOFNAME),
            mail_street: [a.ADDRESS1, a.ADDRESS2].map(clean).filter(Boolean).join(', ') || null,
            mail_city: mail.city,
            mail_state: mail.state,
            mail_zip: mail.zip,
        });
        return r;
    },
};

const FRANKLIN_OH = {
    id: 'OH_FRANKLIN',
    label: 'Franklin County (Columbus) Auditor parcels',
    state: 'OH',
    area: 'Ohio: Franklin County (Columbus and suburbs)',
    homepage: 'https://www.franklincountyauditor.com/',
    kind: 'arcgis',
    url: 'https://gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0',
    centroid: false,
    valueType: 'appraised (market value)',
    baseWhere: "CLASSCD >= '300' AND CLASSCD < '500'",
    valueField: 'TOTVALUEBASE',
    cityWhere: (cities) => `(${cities.map((c) => `UPPER(CVTTXDSCRP) LIKE ${sqlText(`${c.toUpperCase()}%`)}`).join(' OR ')})`,
    zipWhere: (zips) => `ZIPCD IN (${zips.map(sqlText).join(',')})`,
    map(a) {
        const r = blankRecord(this);
        const mailLast = splitCityStateZip(a.MAILNME2);
        const mail = mailLast.state ? { street: clean(a.MAILNME1), city: mailLast.city, state: mailLast.state, zip: mailLast.zip } : splitMailingLine(a.PSTLADDRES);
        const district = clean(a.CVTTXDSCRP)?.split('-')[0]?.replace(/\s+(CITY|VILLAGE|TWP|TOWNSHIP)$/i, '') ?? null;
        Object.assign(r, {
            parcel_id: clean(a.PARCELID),
            property_address: clean(a.SITEADDRESS),
            city: district,
            county: 'Franklin',
            zip: zip5(a.ZIPCD),
            land_use_code: clean(a.CLASSCD),
            land_use_description: clean(a.CLASSDSCRP),
            property_type: classifyOhio(a.CLASSCD, a.CLASSDSCRP),
            building_sqft: num(a.BLDGAREA),
            lot_acres: acresFrom(a.ACRES),
            year_built: year(a.RESYRBLT),
            floors: num(a.FLOORCOUNT),
            value_usd: num(a.TOTVALUEBASE),
            land_value_usd: num(a.LNDVALUEBASE),
            building_value_usd: num(a.BLDVALUEBASE),
            last_sale_date: isoDate(a.SALEDATE),
            last_sale_price_usd: num(a.SALEPRICE),
            owner_raw: clean(a.OWNERNME1),
            owner2_raw: clean(a.OWNERNME2),
            mail_street: mail.street,
            mail_city: mail.city,
            mail_state: mail.state,
            mail_zip: mail.zip,
        });
        return r;
    },
};

// ---------------------------------------------------------------------------
// New York City (Socrata) and Philadelphia (Carto SQL)
// ---------------------------------------------------------------------------

const NYC_BOROUGHS = { MN: 'Manhattan', BX: 'Bronx', BK: 'Brooklyn', QN: 'Queens', SI: 'Staten Island' };
const NYC_CITY_ALIASES = { 'NEW YORK': ['MN'], 'NEW YORK CITY': ['MN', 'BX', 'BK', 'QN', 'SI'], NYC: ['MN', 'BX', 'BK', 'QN', 'SI'], MANHATTAN: ['MN'], BRONX: ['BX'], 'THE BRONX': ['BX'], BROOKLYN: ['BK'], QUEENS: ['QN'], 'STATEN ISLAND': ['SI'] };
const NYC_LETTERS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'N', 'O', 'P', 'Q', 'S', 'T', 'U', 'V', 'Z', 'RB', 'RK', 'RH'];

const NYC = {
    id: 'NYC',
    label: 'NYC Department of City Planning PLUTO',
    state: 'NY',
    area: 'New York City (all five boroughs)',
    homepage: 'https://www.nyc.gov/site/planning/data-maps/open-data/dwn-pluto-mappluto.page',
    kind: 'socrata',
    url: 'https://data.cityofnewyork.us/resource/64uk-42ks.json',
    valueType: 'assessed (NYC assesses commercial property at about 45% of market value)',
    citySupported: (cities) => cities.some((c) => NYC_CITY_ALIASES[c.toUpperCase()]),
    buildWhere({ minValue, cities, zips, bbox }) {
        const parts = [`(${NYC_LETTERS.map((l) => `bldgclass like '${l}%'`).join(' OR ')})`, 'ownername IS NOT NULL'];
        if (minValue) parts.push(`assesstot >= ${Number(minValue)}`);
        if (cities?.length) {
            const boros = [...new Set(cities.flatMap((c) => NYC_CITY_ALIASES[c.toUpperCase()] ?? []))];
            parts.push(boros.length ? `borough in (${boros.map(sqlText).join(',')})` : '1=0');
        }
        if (zips?.length) parts.push(`zipcode in (${zips.map(sqlText).join(',')})`);
        if (bbox) parts.push(`latitude between ${bbox[0]} and ${bbox[2]} and longitude between ${bbox[1]} and ${bbox[3]}`);
        return parts.join(' AND ');
    },
    map(a) {
        const r = blankRecord(this);
        const lat = Number(a.latitude);
        const lon = Number(a.longitude);
        Object.assign(r, {
            parcel_id: a.bbl ? String(Math.round(Number(a.bbl))) : null,
            property_address: clean(a.address),
            city: NYC_BOROUGHS[a.borough] ?? null,
            county: NYC_BOROUGHS[a.borough] ?? null,
            zip: zip5(a.zipcode),
            _point: Number.isFinite(lat) && Number.isFinite(lon) && lat ? [lat, lon] : null,
            land_use_code: clean(a.bldgclass),
            land_use_description: nycClassDescription(a.bldgclass),
            property_type: classifyNyc(a.bldgclass),
            building_sqft: num(a.bldgarea),
            lot_acres: acresFrom(a.lotarea, 'sqft'),
            year_built: year(a.yearbuilt),
            floors: num(a.numfloors),
            units: num(a.unitstotal),
            value_usd: num(a.assesstot),
            land_value_usd: num(a.assessland),
            building_value_usd: num(a.assesstot) && num(a.assessland) ? num(a.assesstot) - num(a.assessland) : null,
            owner_raw: clean(a.ownername),
            zoning: clean(a.zonedist1),
        });
        return r;
    },
};

const PHL_CATEGORIES = ['COMMERCIAL', 'INDUSTRIAL', 'MIXED USE', 'RETAIL', 'OFFICES', 'HOTEL', 'APARTMENTS  > 4 UNITS', 'SPECIAL PURPOSE', 'GARAGE - COMMERCIAL', 'VACANT LAND - NON-RESIDENTIAL'];

const PHL = {
    id: 'PHILADELPHIA',
    label: 'Philadelphia Office of Property Assessment',
    state: 'PA',
    area: 'Philadelphia, PA',
    homepage: 'https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/',
    kind: 'carto',
    url: 'https://phl.carto.com/api/v2/sql',
    valueType: 'assessed (market value)',
    citySupported: (cities) => cities.some((c) => /^phil/i.test(c)),
    buildWhere({ minValue, cities, zips, bbox }) {
        const parts = [`category_code_description IN (${PHL_CATEGORIES.map(sqlText).join(',')})`];
        if (minValue) parts.push(`market_value >= ${Number(minValue)}`);
        if (cities?.length && !cities.some((c) => /^phil/i.test(c))) parts.push('1=0');
        if (zips?.length) parts.push(`LEFT(zip_code, 5) IN (${zips.map(sqlText).join(',')})`);
        if (bbox) parts.push(`the_geom && ST_MakeEnvelope(${bbox[1]}, ${bbox[0]}, ${bbox[3]}, ${bbox[2]}, 4326)`);
        return parts.join(' AND ');
    },
    fields: 'cartodb_id, parcel_number, building_code_new, building_code, location, unit, zip_code, category_code_description, building_code_description_new, building_code_description, owner_1, owner_2, mailing_care_of, mailing_street, mailing_city_state, mailing_zip, market_value, taxable_land, taxable_building, exempt_land, exempt_building, sale_date, sale_price, total_livable_area, total_area, year_built, number_stories, zoning, ST_Y(the_geom) AS lat, ST_X(the_geom) AS lon',
    map(a) {
        const r = blankRecord(this);
        const cat = clean(a.category_code_description);
        const desc = [cat, clean(a.building_code_description_new) ?? clean(a.building_code_description)].filter(Boolean).join(' - ');
        const mail = splitCityStateZip(a.mailing_city_state);
        const type = cat === 'APARTMENTS  > 4 UNITS' ? 'multifamily'
            : cat === 'HOTEL' ? 'hotel'
                : cat === 'VACANT LAND - NON-RESIDENTIAL' ? 'vacant_land'
                    : cat === 'MIXED USE' ? 'mixed_use'
                        : cat === 'GARAGE - COMMERCIAL' ? 'parking'
                            : classifyText(a.building_code_description_new) ?? classifyText(a.building_code_description) ?? (cat === 'INDUSTRIAL' ? 'industrial' : cat === 'OFFICES' ? 'office' : cat === 'RETAIL' ? 'retail' : 'other_commercial');
        Object.assign(r, {
            parcel_id: clean(a.parcel_number),
            property_address: [clean(a.location), clean(a.unit) ? `Unit ${clean(a.unit)}` : null].filter(Boolean).join(' '),
            city: 'Philadelphia',
            county: 'Philadelphia',
            zip: zip5(a.zip_code),
            _point: Number.isFinite(a.lat) && Number.isFinite(a.lon) ? [Math.round(a.lat * 1e6) / 1e6, Math.round(a.lon * 1e6) / 1e6] : null,
            land_use_code: clean(a.building_code_new) ?? clean(a.building_code),
            land_use_description: desc,
            property_type: type,
            building_sqft: num(a.total_livable_area),
            lot_acres: acresFrom(a.total_area, 'sqft'),
            year_built: year(a.year_built),
            floors: num(a.number_stories),
            value_usd: num(a.market_value),
            last_sale_date: isoDate(a.sale_date),
            last_sale_price_usd: num(a.sale_price),
            owner_raw: clean(a.owner_1),
            owner2_raw: clean(a.owner_2),
            care_of_raw: clean(a.mailing_care_of),
            mail_street: clean(a.mailing_street),
            mail_city: mail.city,
            mail_state: mail.state,
            mail_zip: zip5(a.mailing_zip) ?? mail.zip,
            zoning: clean(a.zoning),
        });
        return r;
    },
};

export const SOURCES = [MA, CT, NC, NYC, PHL, DC, FRANKLIN_OH, WI, MN];
export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

/** Carto SQL with retries: the Philadelphia server answers 400 "query_wait_timeout" when busy. */
async function cartoQuery(url, q, log, retries = 4) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${url}?${new URLSearchParams({ q })}`, { headers: { Accept: 'application/json', 'User-Agent': 'commercial-property-owner-leads (Apify Actor)' }, signal: AbortSignal.timeout(120_000) });
            const json = await res.json().catch(() => ({ error: [`HTTP ${res.status}`] }));
            if (json.error || !res.ok) throw new Error(`Carto error: ${[].concat(json.error ?? `HTTP ${res.status}`).join(' ')}`);
            return json;
        } catch (err) {
            lastError = err;
            if (attempt === retries) break;
            const wait = 3000 * 2 ** attempt;
            log?.warning?.(`Philadelphia query failed (${err.message}); retrying in ${wait / 1000}s`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw lastError;
}

/** ArcGIS WHERE clause for a source and the user's filters. */
export function arcgisWhere(source, { minValue, cities, zips, propertyTypes }) {
    const parts = [source.typeWhere && propertyTypes?.length ? source.typeWhere(propertyTypes) : source.baseWhere];
    if (minValue) parts.push(`${source.valueField} >= ${Math.floor(Number(minValue) * (source.valueFieldFactor ?? 1))}`);
    if (cities?.length && source.cityWhere) parts.push(source.cityWhere(cities));
    if (zips?.length && source.zipWhere) parts.push(source.zipWhere(zips));
    return parts.map((p) => `(${p})`).join(' AND ');
}

/**
 * Fetches a source and calls onRecord(rec) for every mapped record.
 * filters: { minValue, cities, zips, bbox }
 */
export async function fetchSource(source, filters, { log, shouldStop = () => false, onRecord, maxRecords = Infinity, concurrency = 4 }) {
    if (source.kind === 'arcgis') {
        const where = arcgisWhere(source, filters);
        return queryLayer(source.url, where, {
            bbox: filters.bbox,
            centroid: source.centroid !== false,
            pointLayer: source.pointLayer === true,
            concurrency,
            maxRecords,
            shouldStop,
            log,
            onBatch: async (features) => {
                for (const f of features) onRecord(source.map(f.attributes, featurePoint(f)));
            },
        });
    }
    if (source.kind === 'socrata') {
        const where = source.buildWhere(filters);
        const pageSize = 25_000;
        let offset = 0;
        let fetched = 0;
        while (!shouldStop() && fetched < maxRecords) {
            const url = `${source.url}?${new URLSearchParams({ $where: where, $limit: String(pageSize), $offset: String(offset), $order: 'bbl' })}`;
            const rows = await fetchJson(url, { log, timeoutMs: 120_000 });
            for (const row of rows) onRecord(source.map(row));
            fetched += rows.length;
            if (rows.length < pageSize) break;
            offset += pageSize;
        }
        return { matched: fetched, fetched };
    }
    if (source.kind === 'carto') {
        const where = source.buildWhere(filters);
        const pageSize = 5_000;
        let offset = 0;
        let fetched = 0;
        while (!shouldStop() && fetched < maxRecords) {
            const q = `SELECT ${source.fields} FROM opa_properties_public WHERE ${where} ORDER BY cartodb_id LIMIT ${pageSize} OFFSET ${offset}`;
            const res = await cartoQuery(source.url, q, log);
            const rows = res.rows ?? [];
            for (const row of rows) onRecord(source.map(row));
            fetched += rows.length;
            if (rows.length < pageSize) break;
            offset += pageSize;
        }
        return { matched: fetched, fetched };
    }
    throw new Error(`Unknown source kind ${source.kind}`);
}
