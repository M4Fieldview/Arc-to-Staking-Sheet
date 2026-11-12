# Arc Data Export to Spreadsheet

Fills in the **S (staked)** columns of an irrigation PM's hole-summary sheet straight from the project's ArcGIS staking web map, so PMs no longer copy counts over from the dashboard or attribute table by hand.

**Pilot project:** 2603 Kettle Forge.

## How it will work
1. The PM opens the site and signs in with their ArcGIS account.
2. They upload their hole-summary sheet (with the **D**/design quantities filled in) and choose the staking web map.
3. The page counts staked features by `HoleNo` for each material column and writes them into the **S** columns. Formulas and formatting are kept.
4. The PM downloads the filled-in sheet, along with a short report of points that couldn't be placed (e.g. blank `HoleNo`).

A hidden **MAPPING** tab in the sheet template tells the tool which layer and filter feed each column (e.g. `Toro Head` where `HeadType='INF34' AND Nozzle='33'`).

## What's in this repo
| File | Purpose |
|---|---|
| `Standardize_HoleNo.ipynb` | Brings older web maps up to the current template: adds a `HoleNo` field and the standard dropdown (`01–18, CH, SG, PG, CG, DR`) to every template layer, and adds it to the Field Maps forms. Run it with `DRY_RUN = True` first. |

## Notes
- Project spreadsheets and web map backups are git-ignored on purpose, so they never reach the repo. Put sanitized test sheets in `test-data/` if needed.
- In a Staking map, every point counts as staked. The INSTALLED TOTALS tab could later be filled the same way from the As-Built map.
