# Commercial Property Owner Leads (Reonomy Alternative)

Find out **who owns commercial buildings**: offices, warehouses, industrial plants, retail, shopping centers, apartment buildings, hotels, medical offices and more. Get the owner's name and mailing address with the property's value, building size, year built and last sale, straight from official county and state property records. No login, no API key, no monthly subscription.

## Who uses it

- **Commercial service companies** (roofing, HVAC, solar, cleaning, security, landscaping, paving, signage, elevators, fire protection) building a list of building owners to pitch.
- **Commercial real estate brokers and investors** looking for off-market owners, out-of-state owners and portfolio owners.
- **Lenders, insurers and property managers** prospecting owners of a given building type and size.
- **Proptech and data teams** that need clean, normalized parcel data across several states in one format.

## What you get

| owner_name | owner_mailing_address | property_address | city | property_type | value_usd | building_sqft | year_built | last_sale_date |
|---|---|---|---|---|---|---|---|---|
| Example Office Owner LLC | 100 Main St Ste 500, Boston, MA 02110 | 200 Example St | Cambridge, MA | office | 48,500,000 | 210,000 | 1987 | 2021-06-30 |
| Example Logistics LP | PO Box 100, Dallas, TX 75201 | 55 Industrial Way | Charlotte, NC | warehouse | 12,700,000 | | 2019 | 2016-03-23 |

*(Illustrative rows.)* Every row also has: owner type, second owner and care-of company (when they are companies), whether the owner is out of state, **how many properties that owner holds in your results and their total value**, county, ZIP, latitude/longitude, the assessor's own land-use description and code, lot size, floors, units, land and building value, last sale price, zoning, parcel ID and a link to the source.

Switch **Output** to *one row per owner* to get a portfolio view: each owner with property count, total value, property types, cities, and their properties listed inside.

## Coverage

| Area | Source |
|---|---|
| Massachusetts (statewide) | MassGIS property tax parcels |
| Connecticut (statewide) | Connecticut CAMA and parcel layer |
| North Carolina (statewide) | NC OneMap parcels |
| Wisconsin (statewide) | Wisconsin statewide parcel database |
| Minnesota (Minneapolis-St. Paul metro and other open-data counties) | MnGeo open parcels |
| New York City (all 5 boroughs) | NYC PLUTO |
| Philadelphia, PA | Office of Property Assessment |
| Washington, DC | Office of Tax and Revenue |
| Columbus, OH (Franklin County) | Franklin County Auditor |

More areas will be added. Tell us which one you need in the Issues tab.

## Property types

Office, medical office, retail, shopping center / big box, restaurant, hotel, apartment buildings (multifamily), mixed use, industrial / manufacturing, warehouse / distribution, self-storage, auto (dealers, repair, gas stations, car washes), parking, healthcare (hospitals, nursing homes, senior living), banks, recreation and entertainment, other commercial, and vacant commercial land. Every county codes land use differently; the Actor maps all of them to these standard types.

## Filters

- **Areas**, **cities or towns**, **ZIP codes**, or a **ZIP code and radius**.
- **Property value** range, **minimum building size**, **year built** range.
- **Last sold** date range (find new owners, or long-time owners).
- **Owner type**: companies, nonprofits, government, religious organizations.
- **Only out-of-state owners** (absentee owners).
- **Owners with at least N properties** (portfolio owners).
- **Maximum results**. Results are sorted by value, biggest first.

## Data quality

- **Companies only.** Properties owned by individuals or personal/family trusts are dropped, and person names are removed from second-owner, care-of and "Attn:" lines.
- **Duplicates merged.** One building split over several parcels (building plus parking lot, or a complex recorded parcel by parcel) comes back as one row with all its parcel IDs.
- **Official values.** Value is what the assessor publishes. Most areas publish market value. New York City publishes assessed value, about 45% of market. The `value_type` field says which.
- New York City records have no owner mailing address or sale dates. North Carolina, Wisconsin and DC records have no building size.

## Pricing

You pay per row returned, plus a small fee per run. Set **Maximum results** or a spending limit and the run stops there.

## Tips

- A whole state with all property types and no value floor can return tens of thousands of rows. Start with a value floor or a few cities.
- Schedule a monthly run with **Last sold on or after** set to last month to get a steady list of new commercial property owners.
