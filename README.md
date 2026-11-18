# Arc-to-Staking-Sheet

**Sync Arc to Staking Sheet:** Fills in the **STAKING TOTALS** tab of an irrigation PM's hole-summary sheet straight from the project's ArcGIS staking web map, so PMs no longer copy counts over from the dashboard or attribute table by hand.

**Pilot project:** 2603 Kettle Forge.

## How it will work
1. The PM opens the site and signs in with their ArcGIS account.
2. They drag in their hole-summary sheet (with the design quantities filled in on **DESIGN TOTALS**) and pick the staking web map from a searchable list (My Organization / My Content / My Favorites). The search starts from the project number in the file name.
3. The page shows what each material column will count, worked out from the column headers (see below). The PM can change any column before syncing.
4. The page counts staked features by `HoleNo` for each material column and writes them into the **S** columns of the **STAKING TOTALS** tab. Formulas and formatting are kept, and **DESIGN TOTALS** and **MISC. CHANGES** are not changed. The PM copies design numbers into the staking tab's **D** columns by hand, hole by hole as work starts, so its TOTAL row only compares the holes in progress.
5. The PM downloads the filled-in sheet, along with a short report of points that couldn't be placed (e.g. blank `HoleNo`).
6. The choices are saved in a hidden **MAPPING** tab of the downloaded sheet, so the next sync on that sheet starts from them.

## How columns are matched
There's no master list of heads and nozzles. The tool reads each material header on DESIGN TOTALS and looks it up in the **dropdown lists of the chosen web map's layers**, so a new head type works as soon as it's in the map's dropdown.
- **Heads:** `Toro FLX34-34` → Toro Head, HeadType `FLX34`, Nozzle `34`. `RB 752-36` / `Rainbird 702` → Rain Bird Head (`Head_Type`). With no brand (`702-32`, `5004 Rotor`), the brand comes from whichever head layer has that head type; if more than one does, the column is marked to check. `I20` counts every I-20 type. "Block" heads match only when the header says Block. Older Rainbird layers that put the nozzle in the head type (`752-20 F`) are handled too.
- **Nozzles:** extra specs tacked onto the nozzle are dropped (`INF 34-348` → nozzle `34`, the longest start that's in the map's nozzle list). Heads with **no nozzle entered** count in a column when it's the sheet's only column for that head type; when there are two (e.g. INF35-34 and INF35-35), they're left off and the report says which columns they could belong to.
- **Other Sprinklers / Other Heads:** every feature in that head layer that no other column counts. The layer is the brand named in the header, or the one most of the sheet's head columns use.
- **Everything else:** the header is matched to a layer name (`Quick Coupler`, `Drain Valve`, `Drip Valve`, …), with a few synonyms (`Mainline Valve` / `Gate Valve` → Isolation Valve, `QCV`, `ARV`, `RCV`). Maker names like `CLOW` are ignored. A size like `8"` filters the layer's size dropdown (`08"`).
- Columns marked **⚠ Check** are still counted (e.g. a nozzle that isn't in the map's list). Columns the tool can't place are **not counted** and left blank until the PM picks a layer. Spare columns with no material name are ignored.

## What's in this repo
| File | Purpose |
|---|---|
| `Hole Summary Template.xlsx` | Blank sheet: **DESIGN TOTALS**, **STAKING TOTALS** (same layout; area and material names link to the design tab) and **MISC. CHANGES**. |
| `index.html`, `js/`, `css/` | The site. Everything runs in the PM's browser; there's no server. |
| `js/headers.js` | Reads the material headers and matches them to the web map's layers and dropdown lists. |
| `js/review.js` | Step 4: the column table and the Change editor. |
| `config.js` | The ArcGIS OAuth client ID and org portal URL. |
| `js/mapping.js` | Counting rules, hole-row rules, and reading/writing the MAPPING tab. |
| `js/xlsx.js` | Edits only the S cells inside the .xlsx and leaves styles, merges, formulas and other tabs untouched. Excel recalculates on open. |
| `test/`, `test-data/` | Saved layer setups and counts from Kettle Forge (Toro) and 2577 Amara (Rain Bird), plus a made-up Rain Bird sheet (`test-data/rainbird-test.xlsx`). `index.html` runs the fill step with them (`?xlsx=…&schema=amara-schema.json&fixture=amara-fixture.json`). `ui.html` runs the whole real page against a fake ArcGIS (pretend sign-in, sample maps), so the UI can be clicked through without signing in. |
| `tools/dev_server.py` | Local server for testing (`python tools/dev_server.py`, then open http://localhost:8765). |
| `Standardize_HoleNo.ipynb` | Brings older web maps up to the current template: adds a `HoleNo` field and the standard dropdown (`01–18, CH, SG, PG, CG, DR`) to every template layer, and adds it to the Field Maps forms. Run it with `DRY_RUN = True` first. |

## Sync rules
- Older sheets without a **STAKING TOTALS** tab get one: a copy of DESIGN TOTALS with its D and S numbers blanked. It replaces a blank **INSTALLED TOTALS** tab; if that tab has numbers in it, it's kept and the new tab goes right after DESIGN TOTALS.
- Billing style, design totals and the "no design here" flags always come from **DESIGN TOTALS**, so they don't depend on how much the PM has copied over yet.
- Each material column counts the features in one layer that match its filter (e.g. Toro Head with `HeadType=INF34`, `Nozzle=33`). "Other Sprinklers" takes every Toro head that no other column claimed.
- The **ADJ** row may be called **Contingency** on some sheets; both work.
- **Process of elimination for area rows** like PRACTICE AREA, whose HoleNo depends on the course (SG at one, PG at another). Once every row with a clear code is matched, HoleNo codes used in the map that still have no row go to the one row whose kind of area allows them: practice-type rows (practice, chipping, putting, academy…) take SG/PG/CG, clubhouse-type rows take CH, range-type rows take DR. If two rows could take a code, it isn't guessed and stays flagged. Blank HoleNo and rows like "Parking Lot" are never guessed. Every guess is listed in the report.
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
