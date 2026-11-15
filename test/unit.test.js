import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerType, businessNameOrNull, isoDate, cleanMailStreet, prettyName } from '../src/normalize.js';
import { classifyText, classifyMassachusetts, classifyOhio, classifyNyc, classifyWisconsin, PROPERTY_TYPE_IDS } from '../src/classify.js';
import { PropertyDeduper } from '../src/dedupe.js';
import { SOURCES, SOURCE_BY_ID, arcgisWhere, splitMailingLine, splitCityStateZip, blankRecord } from '../src/sources/index.js';
import { parseInput, rejectReason, toPropertyRow, toOwnerRows, boundingBox } from '../src/main.js';

test('individuals and personal trusts are never treated as companies', () => {
    for (const n of ['LEE KIM KWONG', 'SMITH JOHN A', 'JOHN & MARY SMITH', 'SMITH FAMILY TRUST', 'JONES JOHN E JR TR', 'DAY JOHN S ETUX',
        'BARRY & HELENE MAWYER LIVING TRUST', 'DEAN W. EVANS, TRUSTEE', 'SLEGER, ERIKA;SLEGER, JASON', 'LEAHY DAVID H TRUSTEE BROTHERS']) {
        assert.equal(ownerType(n), 'person', n);
    }
});

test('companies, government and nonprofits are recognised', () => {
    for (const n of ['GOLF CITY LLC', 'TOWN CENTER ASSOCIATES LLC', 'ABC REALTY TRUST', 'FEDERAL REALTY INVESTMENT TRUST', 'METROPOLITAN LIFE INSURANCE CO',
        '10 CHURCH STREET LLC', 'SIMON PROPERTY GROUP L P', 'AMAZON', '136 TURNPIKE ROAD LLC', 'ROUTE 140 SCHOOL STREET LLC', 'C/O ENCORE BOSTON HARBOR LLC']) {
        assert.equal(ownerType(n), 'company', n);
    }
    for (const n of ['CITY OF BOSTON', 'TOWN OF ACTON', 'BRIDGEPORT CITY OF', 'DISTRICT OF COLUMBIA', 'REVERE HOUSING AUTHORITY']) assert.equal(ownerType(n), 'government', n);
    for (const n of ['TEMPLE UNIVERSITY', 'TRUSTEES OF COLUMBIA UNIVERSITY', 'EMERSON HOSPITAL']) assert.equal(ownerType(n), 'nonprofit', n);
    assert.equal(ownerType('FIRST BAPTIST CHURCH'), 'religious');
    assert.equal(ownerType('UNAVAILABLE OWNER'), 'unknown');
});

test('second owner and care-of lines keep only organisations', () => {
    assert.equal(businessNameOrNull('C/O WEIDNER INVESTMENTS SERVICES INC'), 'WEIDNER INVESTMENTS SERVICES INC');
    assert.equal(businessNameOrNull('WU JI SHAN'), null);
    assert.equal(cleanMailStreet('Attn: Dean Corrigan, P O Box 69'), 'P O Box 69');
});

test('land-use text maps to property types and homes are dropped', () => {
    const cases = {
        'COM/ OFFICE BLDG': 'office', 'General Office Buildings': 'office', 'MINI WAREHOUSE': 'self_storage', 'INDUSTRIAL WAREHOUSE': 'warehouse',
        'MULTI FAMILY': 'multifamily', '4a Apartment 4 Or More Units': 'multifamily', 'Residential-Apartment (Walkup)': 'multifamily',
        'HOTEL/MOTEL < 7 FLOORS': 'hotel', 'FAST FOOD': 'restaurant', 'SHOPPING CENTER - STRIP': 'shopping_center', 'MEDICAL OFFICE': 'medical_office',
        'NURSING HOME': 'healthcare', 'Commercial': 'other_commercial', 'C': 'other_commercial', 'IND': 'industrial', 'COMMERCIAL VACANT LAND': 'vacant_land',
        'Mixed Use (Primarily Commercial, some Residential)': 'mixed_use', 'RETAIL/APTS OVER-WALKUP': 'mixed_use', 'Store-Restaurant': 'restaurant',
    };
    for (const [d, t] of Object.entries(cases)) assert.equal(classifyText(d), t, d);
    for (const d of ['SINGLE FAMILY RESIDENTIAL', 'Two Family', 'CHURCH', 'Exempt Commercial', 'Res Condominium', 'VACANT RURAL', 'Residential',
        'Mixed Use (Primarily Residential, some Agriculture)', 'SCHOOL - PUBLIC', 'Residential-Garage', 'AGRICULTURE', 'R', 'E']) {
        assert.equal(classifyText(d), null, d);
    }
});

test('code systems map to property types', () => {
    assert.equal(classifyMassachusetts('340'), 'office');
    assert.equal(classifyMassachusetts('3400'), 'office');
    assert.equal(classifyMassachusetts('401'), 'warehouse');
    assert.equal(classifyMassachusetts('112'), 'multifamily');
    assert.equal(classifyMassachusetts('101'), null);
    assert.equal(classifyMassachusetts('031'), 'mixed_use');
    assert.equal(classifyMassachusetts('012'), null);
    assert.equal(classifyMassachusetts('930'), null);
    assert.equal(classifyOhio('447', 'OFFICE BUILDING 1-2 STORIES'), 'office');
    assert.equal(classifyOhio('403', 'APARTMENTS 40 OR MORE RENTAL UNITS'), 'multifamily');
    assert.equal(classifyOhio('510', 'SINGLE FAMILY'), null);
    assert.equal(classifyNyc('O4'), 'office');
    assert.equal(classifyNyc('D4'), null, 'co-ops are owned by residents');
    assert.equal(classifyNyc('A1'), null);
    assert.equal(classifyNyc('E1'), 'warehouse');
    assert.equal(classifyWisconsin('2'), 'other_commercial');
    assert.equal(classifyWisconsin('1,6'), null);
});

test('every source maps a record to the full field set', () => {
    for (const s of SOURCES) {
        assert.ok(s.label && s.area && s.homepage && s.valueType, s.id);
        const r = s.map({}, null);
        assert.deepEqual(Object.keys(r).sort(), Object.keys(blankRecord(s)).sort(), s.id);
    }
    const where = arcgisWhere(SOURCE_BY_ID.CT, { minValue: 1_000_000, cities: ["O'Hara"], propertyTypes: ['office'] });
    assert.match(where, /Assessed_Total >= 700000/);
    assert.match(where, /'O''HARA'/);
    assert.doesNotMatch(where, /'%APART%'/, 'type filter narrows the server query');
});

test('mailing lines split into parts', () => {
    assert.deepEqual(splitMailingLine('PO BOX 30 , WISCONSIN DELLS WI 53965'), { street: 'PO BOX 30', city: 'WISCONSIN DELLS', state: 'WI', zip: '53965' });
    assert.deepEqual(splitCityStateZip('LONDON, OH 43140'), { city: 'LONDON', state: 'OH', zip: '43140' });
    assert.deepEqual(splitCityStateZip('WASHINGTON DC 20001-1234'), { city: 'WASHINGTON', state: 'DC', zip: '20001' });
    assert.equal(isoDate('20260227'), '2026-02-27');
    assert.equal(isoDate('2/21/2024 12:00:00 AM'), '2024-02-21');
    assert.equal(isoDate(1751950800000), '2025-07-08');
    assert.equal(isoDate('19000101'), null);
    assert.equal(prettyName('ACME REALTY LLC'), 'Acme Realty LLC');
});

const rec = (o) => ({ ...blankRecord(SOURCE_BY_ID.MA), parcel_id: 'P1', property_address: '1 MAIN ST', city: 'BOSTON', zip: '02110', property_type: 'office', value_usd: 5_000_000, owner_raw: 'ACME REALTY LLC', mail_street: '9 ELM ST', mail_city: 'HARTFORD', mail_state: 'CT', mail_zip: '06103', ...o });

test('duplicate parcels merge', () => {
    const d = new PropertyDeduper();
    d.add(rec());
    assert.equal(d.add(rec()), false, 'same parcel');
    assert.equal(d.add(rec({ parcel_id: 'P2', value_usd: 1_000_000 })), false, 'same owner and address');
    assert.equal(d.rows[0].value_usd, 6_000_000, 'separate parcels at one address add up');
    assert.deepEqual(d.rows[0].parcel_ids, ['P1', 'P2']);
    assert.equal(d.add(rec({ parcel_id: 'P3', property_address: '5 MAIN ST', value_usd: 6_000_000 })), false, 'complex with repeated value');
    assert.equal(d.rows[0].value_usd, 6_000_000);
    assert.equal(d.add(rec({ parcel_id: 'P9', property_address: '99 OTHER ST', value_usd: 1_234_567 })), true);
});

test('input defaults and validation', () => {
    const i = parseInput({});
    assert.deepEqual(i.areas, ['MA']);
    assert.deepEqual(i.propertyTypes, ['office', 'industrial', 'warehouse']);
    assert.equal(i.minValue, 2_000_000);
    assert.deepEqual(parseInput({ zipCode: '19103', radiusMiles: 5 }).areas, ['PHILADELPHIA']);
    assert.throws(() => parseInput({ areas: ['TX'] }), /Unknown area/);
    assert.throws(() => parseInput({ propertyTypes: ['castle'] }), /Unknown property type/);
    assert.throws(() => parseInput({ zipCode: '99999' }), /not found/);
    assert.ok(PROPERTY_TYPE_IDS.includes('office'));
    const [s, w, n, e] = boundingBox([42.36, -71.06], 10);
    assert.ok(s < 42.36 && n > 42.36 && w < -71.06 && e > -71.06);
});

test('filters, output rows and owner roll-up', () => {
    const input = parseInput({ areas: ['MA'], propertyTypes: ['office'], minValue: 1_000_000 });
    assert.equal(rejectReason(rec(), input), null);
    assert.equal(rejectReason(rec({ owner_raw: 'SMITH JOHN A' }), input), 'owner_is_person');
    assert.equal(rejectReason(rec({ property_type: 'retail' }), input), 'property_type');
    assert.equal(rejectReason(rec({ value_usd: 10 }), input), 'value');
    assert.equal(rejectReason(rec({ owner_raw: 'CITY OF BOSTON' }), input), 'owner_type');
    assert.equal(rejectReason(rec({ mail_state: 'MA' }), { ...input, absenteeOnly: true }), 'not_absentee');
    const r = rec();
    rejectReason(r, input);
    const row = toPropertyRow({ ...r, parcel_ids: ['P1'] }, input, { count: 2, value: 9e6 }, 'now');
    assert.equal(row.owner_name, 'Acme Realty LLC');
    assert.equal(row.owner_mailing_address, '9 Elm St, Hartford, CT 06103');
    assert.equal(row.owner_out_of_state, true);
    assert.equal(row.owner_property_count, 2);
    assert.equal(row.property_type_label, 'Office buildings');
    const owners = toOwnerRows([row, { ...row, property_address: '2 Main St', value_usd: 1 }]);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].property_count, 2);
    assert.equal(owners[0].properties[0].property_address, '1 Main St');
});
