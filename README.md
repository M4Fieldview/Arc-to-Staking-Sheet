# Arc-to-Staking-Sheet

**Sync Arc to Staking Sheet:** Fills in the **STAKING TOTALS** tab of an irrigation PM's hole-summary sheet straight from the project's ArcGIS staking web map, so PMs no longer copy counts over from the dashboard or attribute table by hand.

**Pilot project:** 2603 Kettle Forge.

## How it will work
1. The PM opens the site and signs in with their ArcGIS account.
2. They drag in their hole-summary sheet (with the design quantities filled in on **DESIGN TOTALS**) and pick the staking web map from a searchable list (My Organization / My Content / My Favorites). The search starts from the project number in the file name.
3. The page counts staked features by `HoleNo` for each material column and writes them into the **S** columns of the **STAKING TOTALS** tab. Formulas and formatting are kept, and **DESIGN TOTALS** and **MISC. CHANGES** are not changed. The PM copies design numbers into the staking tab's **D** columns by hand, hole by hole as work starts, so its TOTAL row only compares the holes in progress.
4. The PM downloads the filled-in sheet, along with a short report of points that couldn't be placed (e.g. blank `HoleNo`).

A hidden **MAPPING** tab in the sheet template tells the tool which layer and filter feed each column (e.g. `Toro Head` where `HeadType='INF34' AND Nozzle='33'`).

## What's in this repo
| File | Purpose |
|---|---|
| `Hole Summary Template.xlsx` | Blank sheet: **DESIGN TOTALS**, **STAKING TOTALS** (same layout; area and material names link to the design tab) and **MISC. CHANGES**. |
| `index.html`, `js/`, `css/` | The site. Everything runs in the PM's browser; there's no server. |
| `config.js` | The ArcGIS OAuth client ID and org portal URL. |
| `js/mapping.js` | The standard column mapping (layer + filter for each material) and the hole-row rules. |
| `js/xlsx.js` | Edits only the S cells inside the .xlsx and leaves styles, merges, formulas and other tabs untouched. Excel recalculates on open. |
| `test/` | `index.html` runs the fill step with saved counts (`kettle-forge-fixture.json`). `ui.html` runs the whole real page against a fake ArcGIS (pretend sign-in, sample maps), so the UI can be clicked through without signing in. |
| `tools/dev_server.py` | Local server for testing (`python tools/dev_server.py`, then open http://localhost:8765). |
| `Standardize_HoleNo.ipynb` | Brings older web maps up to the current template: adds a `HoleNo` field and the standard dropdown (`01–18, CH, SG, PG, CG, DR`) to every template layer, and adds it to the Field Maps forms. Run it with `DRY_RUN = True` first. |

## Sync rules
- Older sheets without a **STAKING TOTALS** tab get one: a copy of DESIGN TOTALS with its D and S numbers blanked. It replaces a blank **INSTALLED TOTALS** tab; if that tab has numbers in it, it's kept and the new tab goes right after DESIGN TOTALS.
- Billing style, design totals and the "no design here" flags always come from **DESIGN TOTALS**, so they don't depend on how much the PM has copied over yet.
- Each material column counts the features in one layer that match its filter (e.g. Toro Head with `HeadType=INF34`, `Nozzle=33`). "Other Sprinklers" takes every Toro head that no other column claimed.
- Rows map by name: `HOLE 7` → HoleNo `07`, `SHORT GAME` → `SG`, and `DR`/`CG`/`PG`/`CH` as is. Rows with no matching code (like **ADJ**) are never touched.
- A count is written only where something is staked. A cell that already held a number is reset to 0 if nothing is staked there now.
- Each column's billing style comes from its D column. **Billed by hole**: design quantities sit on hole rows. **Billed in total**: hole rows are blank/0 and the total sits in a row like ADJ (mainline valves, Hunter temp heads).
- Flags, each listing OBJECTIDs:
  - **Blank HoleNo**: counted in the **ADJ** row's S cell so the TOTAL always matches what was staked. Flagged unless the column is billed in total, where the hole doesn't matter. The tool owns ADJ's S cells and refills them every sync, so by-hand staked adjustments go there after the final sync.
  - **Staked on a hole with no design there** (by-hole columns): likely a wrong HoleNo or head/nozzle. Never raised for billed-in-total columns.
  - **Column with no design quantity at all** (e.g. heads landing in "Other Sprinklers").
  - **No matching column**, and **a hole with no row on the sheet**.
- The tool also recomputes the staking tab's +/- and TOTAL formula results before saving, because Excel's Protected View (used for every downloaded file) shows saved results without recalculating.

## Notes
- Project spreadsheets and web map backups are git-ignored on purpose, so they never reach the repo. Put sanitized test sheets in `test-data/` if needed.
- In a Staking map, every point counts as staked. The INSTALLED TOTALS tab could later be filled the same way from the As-Built map.
