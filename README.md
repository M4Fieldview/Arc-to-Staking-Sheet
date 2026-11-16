# Arc-to-Staking-Sheet

**Sync Arc to Staking Sheet:** Fills in the **S (staked)** columns of an irrigation PM's hole-summary sheet straight from the project's ArcGIS staking web map, so PMs no longer copy counts over from the dashboard or attribute table by hand.

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
| `index.html`, `js/`, `css/` | The site. Everything runs in the PM's browser; there's no server. |
| `config.js` | The ArcGIS OAuth client ID and org portal URL. |
| `js/mapping.js` | The standard column mapping (layer + filter for each material) and the hole-row rules. |
| `js/xlsx.js` | Edits only the S cells inside the .xlsx and leaves styles, merges, formulas and other tabs untouched. Excel recalculates on open. |
| `test/` | Test harness: runs the fill step with saved counts (`kettle-forge-fixture.json`) instead of a live sign-in. |
| `tools/dev_server.py` | Local server for testing (`python tools/dev_server.py`, then open http://localhost:8765). |
| `Standardize_HoleNo.ipynb` | Brings older web maps up to the current template: adds a `HoleNo` field and the standard dropdown (`01–18, CH, SG, PG, CG, DR`) to every template layer, and adds it to the Field Maps forms. Run it with `DRY_RUN = True` first. |

## Sync rules
- Each material column counts the features in one layer that match its filter (e.g. Toro Head with `HeadType=INF34`, `Nozzle=33`). "Other Sprinklers" takes every Toro head that no other column claimed.
- Rows map by name: `HOLE 7` → HoleNo `07`, `SHORT GAME` → `SG`, and `DR`/`CG`/`PG`/`CH` as is. Rows with no matching code (like **ADJ**) are never touched.
- A count is written only where something is staked. A cell that already held a number is reset to 0 if nothing is staked there now.
- Anything that can't be placed (blank HoleNo, no matching column, a hole with no row) is listed on the results page instead of being dropped silently.

## Notes
- Project spreadsheets and web map backups are git-ignored on purpose, so they never reach the repo. Put sanitized test sheets in `test-data/` if needed.
- In a Staking map, every point counts as staked. The INSTALLED TOTALS tab could later be filled the same way from the As-Built map.
