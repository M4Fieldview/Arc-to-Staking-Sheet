// Minimal .xlsx reader/patcher.
// Only the cells we write are changed. Everything else in the workbook (styles, merged
// cells, formulas, other tabs) stays byte-for-byte as the PM made it. Requires global JSZip.

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function nextCol(col, by = 1) { return numToCol(colToNum(col) + by); }
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: m[1], row: Number(m[2]) };
}

// ---------- tiny formula evaluator (enough for +/- and SUM totals) ----------
class Unsupported extends Error {}
const REF_RE = /(^|[^A-Za-z0-9_!'.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g;

/** Moves relative references in a shared formula by (dc, dr), like Excel's fill-down. */
function shiftRefs(text, dc, dr) {
  return text.replace(REF_RE, (all, pre, cAbs, col, rAbs, row) =>
    pre + cAbs + (cAbs ? col : numToCol(colToNum(col) + dc)) + rAbs + (rAbs ? row : Number(row) + dr));
}

function evaluateFormula(text, cellNum) {
  if (/[!'"\[{]/.test(text)) throw new Unsupported("refers to another tab or uses text");
  const tokens = text.replace(/\s+/g, "").match(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|[A-Z]+(?=\()|\d+(?:\.\d+)?(?:E[+-]?\d+)?|[-+*/(),]/gi);
  if (!tokens || tokens.join("") !== text.replace(/\s+/g, "")) throw new Unsupported("unknown syntax");
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const clean = (r) => r.replace(/\$/g, "").toUpperCase();
  const rangeRefs = (a, b) => {
    const A = splitRef(clean(a)), B = splitRef(clean(b));
    const out = [];
    for (let r = Math.min(A.row, B.row); r <= Math.max(A.row, B.row); r++)
      for (let c = Math.min(colToNum(A.col), colToNum(B.col)); c <= Math.max(colToNum(A.col), colToNum(B.col)); c++)
        out.push(numToCol(c) + r);
    return out;
  };
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = next(), r = factor();
      if (op === "/" && r === 0) throw new Unsupported("divide by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function factor() {
    const t = next();
    if (t === undefined) throw new Unsupported("unexpected end");
    if (t === "+") return factor();
    if (t === "-") return -factor();
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Unsupported("missing )"); return v; }
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Z]+$/i.test(t) && peek() === "(") {
      if (t.toUpperCase() !== "SUM") throw new Unsupported(`function ${t}`);
      next();
      let sum = 0;
      while (peek() !== ")") {
        const a = peek();
        if (a && a.includes(":")) { next(); const [x, y] = a.split(":"); for (const r of rangeRefs(x, y)) sum += cellNum(r, true); }
        else sum += expr();
        if (peek() === ",") next(); else if (peek() !== ")") throw new Unsupported("bad SUM arguments");
      }
      next();
      return sum;
    }
    if (t.includes(":")) throw new Unsupported("range outside SUM");
    if (/^\$?[A-Z]{1,3}\$?\d+$/i.test(t)) return cellNum(clean(t), false);
    throw new Unsupported(`token ${t}`);
  }
  const v = expr();
  if (i !== tokens.length) throw new Unsupported("trailing tokens");
  return v;
}

const parseXml = (text) =>new DOMParser().parseFromString(text, "application/xml");
// Browsers keep the original <?xml ...?> line when serializing a parsed document. Only add one if it's missing.
const serialize = (doc) => {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith("<?xml") ? s : XML_DECL + s;
};
const children = (el, local) => [...el.children].filter((c) => c.localName === local);

export async function openWorkbook(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = async (p) => parseXml(await zip.file(p).async("string"));
  const wbDoc = await read("xl/workbook.xml");
  const relsDoc = await read("xl/_rels/workbook.xml.rels");
  const rels = {};
  for (const r of relsDoc.getElementsByTagName("Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
  const sheets = [...wbDoc.getElementsByTagNameNS(NS, "sheet")].map((s) => {
    let target = rels[s.getAttributeNS(RNS, "id")];
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    return { name: s.getAttribute("name"), path: target };
  });
  let shared = [];
  if (zip.file("xl/sharedStrings.xml")) {
    const ss = await read("xl/sharedStrings.xml");
    shared = [...ss.getElementsByTagNameNS(NS, "si")].map((si) =>
      [...si.getElementsByTagNameNS(NS, "t")].map((t) => t.textContent).join(""));
  }
  return new Workbook(zip, wbDoc, sheets, shared);
}

class Workbook {
  constructor(zip, wbDoc, sheetList, shared) {
    this.zip = zip; this.wbDoc = wbDoc; this.sheetList = sheetList; this.shared = shared;
    this.loaded = new Map();
  }
  get sheetNames() { return this.sheetList.map((s) => s.name); }

  async sheet(name) {
    const info = this.sheetList.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!info) return null;
    if (!this.loaded.has(info.path)) {
      const doc = parseXml(await this.zip.file(info.path).async("string"));
      this.loaded.set(info.path, new Sheet(this, info.name, info.path, doc));
    }
    return this.loaded.get(info.path);
  }

  /**
   * Adds a tab named `newName` that's a copy of tab `sourceName` (formatting, merges, formulas, values),
   * placed right after it. With `replace`, the copy takes over that existing tab instead (same position,
   * renamed). Returns the new Sheet.
   */
  async addSheetCopy(sourceName, newName, { replace = null } = {}) {
    const src = this.sheetList.find((s) => s.name === sourceName);
    const doc = parseXml(await this.zip.file(src.path).async("string"));
    const root = doc.documentElement;
    root.removeAttribute("xr:uid");
    for (const v of doc.getElementsByTagNameNS(NS, "sheetView")) v.removeAttribute("tabSelected");
    // Drop links to the source tab's own parts (printer settings, drawings, tables): the copy has none.
    for (const el of [...doc.getElementsByTagName("*")]) {
      if (!el.hasAttributeNS(RNS, "id")) continue;
      if (el.localName === "pageSetup" || el.localName === "hyperlink") { el.removeAttributeNS(RNS, "id"); continue; }
      const parent = el.parentNode;
      parent.removeChild(el);
      if (parent !== root && !parent.children.length) parent.parentNode.removeChild(parent);
    }

    const wbRoot = this.wbDoc.documentElement;
    const sheetEls = [...this.wbDoc.getElementsByTagNameNS(NS, "sheet")];
    const quoted = (n) => `'${n.replace(/'/g, "''")}'!`;
    let path;
    if (replace) {
      const info = this.sheetList.find((s) => s.name === replace);
      path = info.path;
      sheetEls.find((e) => e.getAttribute("name") === replace).setAttribute("name", newName);
      for (const dn of this.wbDoc.getElementsByTagNameNS(NS, "definedName"))
        dn.textContent = dn.textContent.split(quoted(replace)).join(quoted(newName));
      info.name = newName;
      this.loaded.delete(path);
      const app = this.zip.file("docProps/app.xml");
      if (app) {
        const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const text = (await app.async("string"))
          .split(`>${x(replace)}<`).join(`>${x(newName)}<`)
          .split(x(quoted(replace))).join(x(quoted(newName)));
        this.zip.file("docProps/app.xml", text, { createFolders: false });
      }
    } else {
      let n = 1;
      while (this.zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
      path = `xl/worksheets/sheet${n}.xml`;
      const relsDoc = parseXml(await this.zip.file("xl/_rels/workbook.xml.rels").async("string"));
      const relRoot = relsDoc.documentElement;
      const ids = [...relRoot.children].map((r) => Number(r.getAttribute("Id").replace(/\D/g, "")) || 0);
      const rId = `rId${Math.max(0, ...ids) + 1}`;
      const rel = relsDoc.createElementNS(relRoot.namespaceURI, "Relationship");
      rel.setAttribute("Id", rId);
      rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet");
      rel.setAttribute("Target", `worksheets/sheet${n}.xml`);
      relRoot.appendChild(rel);
      this.zip.file("xl/_rels/workbook.xml.rels", serialize(relsDoc), { createFolders: false });

      const ctDoc = parseXml(await this.zip.file("[Content_Types].xml").async("string"));
      const ov = ctDoc.createElementNS(ctDoc.documentElement.namespaceURI, "Override");
      ov.setAttribute("PartName", "/" + path);
      ov.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
      ctDoc.documentElement.appendChild(ov);
      this.zip.file("[Content_Types].xml", serialize(ctDoc), { createFolders: false });

      const srcEl = sheetEls.find((e) => e.getAttribute("name") === sourceName);
      const index = sheetEls.indexOf(srcEl) + 1;
      const el = this.wbDoc.createElementNS(NS, "sheet");
      el.setAttribute("name", newName);
      el.setAttribute("sheetId", String(Math.max(...sheetEls.map((e) => Number(e.getAttribute("sheetId")))) + 1));
      el.setAttributeNS(RNS, "r:id", rId);
      srcEl.parentNode.insertBefore(el, srcEl.nextSibling);
      // Tab-specific names (print titles etc.) and the open tab point at tabs by position.
      for (const dn of this.wbDoc.getElementsByTagNameNS(NS, "definedName")) {
        const i = dn.getAttribute("localSheetId");
        if (i !== null && Number(i) >= index) dn.setAttribute("localSheetId", String(Number(i) + 1));
      }
      // Give the copy the source tab's print titles / print area.
      for (const dn of [...this.wbDoc.getElementsByTagNameNS(NS, "definedName")]) {
        if (dn.getAttribute("localSheetId") !== String(index - 1) || !/^_xlnm\./.test(dn.getAttribute("name"))) continue;
        const copy = dn.cloneNode(true);
        copy.setAttribute("localSheetId", String(index));
        copy.textContent = dn.textContent.split(quoted(sourceName)).join(quoted(newName));
        dn.parentNode.insertBefore(copy, dn.nextSibling);
      }
      for (const v of this.wbDoc.getElementsByTagNameNS(NS, "workbookView")) {
        const a = v.getAttribute("activeTab");
        if (a !== null && Number(a) >= index) v.setAttribute("activeTab", String(Number(a) + 1));
      }
      this.sheetList.splice(index, 0, { name: newName, path });
    }

    // The calculation chain lists formula cells by tab; let Excel rebuild it.
    if (this.zip.file("xl/calcChain.xml")) {
      this.zip.remove("xl/calcChain.xml");
      const relsDoc = parseXml(await this.zip.file("xl/_rels/workbook.xml.rels").async("string"));
      for (const r of [...relsDoc.documentElement.children])
        if (/\/calcChain$/.test(r.getAttribute("Type"))) r.parentNode.removeChild(r);
      this.zip.file("xl/_rels/workbook.xml.rels", serialize(relsDoc), { createFolders: false });
      const ctDoc = parseXml(await this.zip.file("[Content_Types].xml").async("string"));
      for (const o of [...ctDoc.documentElement.children])
        if (o.getAttribute("PartName") === "/xl/calcChain.xml") o.parentNode.removeChild(o);
      this.zip.file("[Content_Types].xml", serialize(ctDoc), { createFolders: false });
    }

    const sheet = new Sheet(this, newName, path, doc);
    sheet.dirty = true;
    this.loaded.set(path, sheet);
    return sheet;
  }

  /** Returns a Blob of the patched workbook. Excel recalculates every formula when it's opened. */
  async toBlob() {
    for (const sh of this.loaded.values()) {
      if (sh.dirty) this.zip.file(sh.path, serialize(sh.doc), { createFolders: false });
    }
    const root = this.wbDoc.documentElement;
    let calcPr = children(root, "calcPr")[0];
    if (!calcPr) {
      calcPr = this.wbDoc.createElementNS(NS, "calcPr");
      const after = ["oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes",
        "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];
      const before = [...root.children].find((c) => after.includes(c.localName));
      root.insertBefore(calcPr, before || null);
    }
    calcPr.setAttribute("fullCalcOnLoad", "1");
    this.zip.file("xl/workbook.xml", serialize(this.wbDoc), { createFolders: false });
    return this.zip.generateAsync({
      type: "blob", compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
}

class Sheet {
  constructor(wb, name, path, doc) {
    this.wb = wb; this.name = name; this.path = path; this.doc = doc; this.dirty = false;
    this.sheetData = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  }

  get maxRow() {
    const rows = children(this.sheetData, "row");
    return rows.length ? Number(rows[rows.length - 1].getAttribute("r")) : 0;
  }

  _row(r, create) {
    for (const row of children(this.sheetData, "row")) {
      const n = Number(row.getAttribute("r"));
      if (n === r) return row;
      if (n > r) {
        if (!create) return null;
        const el = this.doc.createElementNS(NS, "row");
        el.setAttribute("r", String(r));
        this.sheetData.insertBefore(el, row);
        return el;
      }
    }
    if (!create) return null;
    const el = this.doc.createElementNS(NS, "row");
    el.setAttribute("r", String(r));
    this.sheetData.appendChild(el);
    return el;
  }

  _cell(ref, create) {
    const { col, row } = splitRef(ref);
    const rowEl = this._row(row, create);
    if (!rowEl) return null;
    const target = colToNum(col);
    for (const c of children(rowEl, "c")) {
      const n = colToNum(splitRef(c.getAttribute("r")).col);
      if (n === target) return c;
      if (n > target) {
        if (!create) return null;
        const el = this.doc.createElementNS(NS, "c");
        el.setAttribute("r", ref);
        rowEl.insertBefore(el, c);
        rowEl.removeAttribute("spans");
        return el;
      }
    }
    if (!create) return null;
    const el = this.doc.createElementNS(NS, "c");
    el.setAttribute("r", ref);
    rowEl.appendChild(el);
    rowEl.removeAttribute("spans");
    return el;
  }

  /** Cell value as shown (shared/inline strings resolved, cached formula results). */
  value(ref) {
    const c = this._cell(ref, false);
    if (!c) return null;
    const t = c.getAttribute("t");
    const v = children(c, "v")[0];
    if (t === "s") return v ? this.wb.shared[Number(v.textContent)] : null;
    if (t === "inlineStr") return [...c.getElementsByTagNameNS(NS, "t")].map((x) => x.textContent).join("");
    if (!v) return null;
    if (t === "str" || t === "e") return v.textContent;
    if (t === "b") return v.textContent === "1";
    const n = Number(v.textContent);
    return Number.isNaN(n) ? v.textContent : n;
  }

  text(ref) {
    const v = this.value(ref);
    return v === null || v === undefined ? "" : String(v).trim();
  }

  hasFormula(ref) {
    const c = this._cell(ref, false);
    return !!(c && children(c, "f").length);
  }

  /** Empties a typed-in value (keeps the cell's formatting). Formula cells are left alone. */
  clearValue(ref) {
    const c = this._cell(ref, false);
    if (!c || children(c, "f").length || !c.firstChild) return;
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute("t");
    this.dirty = true;
  }

  /** How many cells hold a typed-in number (not a formula result). */
  typedNumberCount() {
    let n = 0;
    for (const c of this.sheetData.getElementsByTagNameNS(NS, "c")) {
      const t = c.getAttribute("t");
      if (!children(c, "f").length && children(c, "v").length && (!t || t === "n")) n++;
    }
    return n;
  }

  /**
   * Recomputes the saved results of this tab's formulas after we've changed cells.
   * Excel's Protected View (always used for downloaded files) shows saved results without recalculating,
   * so they must already be right. Handles the formulas these sheets use: cell refs, numbers,
   * + - * / ( ), and SUM over ranges. Anything else (other tabs, other functions) is left as is;
   * Excel recalculates everything anyway once editing is enabled (fullCalcOnLoad).
   * Returns { updated, skipped }.
   */
  recalc() {
    const formulas = new Map();   // ref -> formula text
    const masters = new Map();    // shared formula id -> { text, col, row }
    const cells = [];
    for (const row of children(this.sheetData, "row")) {
      for (const c of children(row, "c")) {
        const f = children(c, "f")[0];
        if (f) cells.push([c.getAttribute("r"), f]);
      }
    }
    for (const [ref, f] of cells) {
      if (f.getAttribute("t") === "shared" && f.textContent.trim()) {
        const { col, row } = splitRef(ref);
        masters.set(f.getAttribute("si"), { text: f.textContent, col: colToNum(col), row });
      }
    }
    for (const [ref, f] of cells) {
      const t = f.getAttribute("t");
      if (t === "array" || t === "dataTable") continue;
      let text = f.textContent.trim();
      if (!text && t === "shared") {
        const m = masters.get(f.getAttribute("si"));
        if (!m) continue;
        const { col, row } = splitRef(ref);
        text = shiftRefs(m.text, colToNum(col) - m.col, row - m.row);
      }
      if (text) formulas.set(ref, text);
    }

    const memo = new Map();
    const evaluating = new Set();
    const cellNum = (ref, inSum) => {
      if (formulas.has(ref)) return evalRef(ref);
      const v = this.value(ref);
      if (v === null || v === "") return 0;
      if (typeof v === "number") return v;
      if (inSum) return 0;               // SUM skips text, like Excel
      throw new Unsupported(`text in ${ref}`);
    };
    const evalRef = (ref) => {
      if (memo.has(ref)) return memo.get(ref);
      if (evaluating.has(ref)) throw new Unsupported("circular reference");
      evaluating.add(ref);
      try {
        const val = evaluateFormula(formulas.get(ref), cellNum);
        memo.set(ref, val);
        return val;
      } finally { evaluating.delete(ref); }
    };

    let updated = 0, skipped = 0;
    for (const ref of formulas.keys()) {
      let val;
      try { val = evalRef(ref); } catch (e) { if (e instanceof Unsupported) { skipped++; continue; } throw e; }
      if (!Number.isFinite(val)) { skipped++; continue; }
      const c = this._cell(ref, false);
      let v = children(c, "v")[0];
      if (!v) { v = this.doc.createElementNS(NS, "v"); c.appendChild(v); }
      const text = String(Math.round(val * 1e10) / 1e10);
      if (v.textContent !== text || c.hasAttribute("t")) {
        v.textContent = text;
        c.removeAttribute("t");
        this.dirty = true;
        updated++;
      }
    }
    return { updated, skipped };
  }

  /** Writes a number, keeping the cell's style (or borrowing styleFromRef's style for a brand-new cell). */
  setNumber(ref, num, styleFromRef) {
    const existed = !!this._cell(ref, false);
    const c = this._cell(ref, true);
    if (!existed && styleFromRef) {
      const s = this._cell(styleFromRef, false)?.getAttribute("s");
      if (s) c.setAttribute("s", s);
    }
    c.removeAttribute("t");
    while (c.firstChild) c.removeChild(c.firstChild);
    const v = this.doc.createElementNS(NS, "v");
    v.textContent = String(num);
    c.appendChild(v);
    this.dirty = true;
  }
}
