// ArcGIS sign-in (OAuth popup via Esri's arcgis-rest-js) and the few REST calls the tool needs.
// Requires global `arcgisRest` and window.APP_CONFIG (config.js).
import { HOLE_FIELD } from "./mapping.js";

const cfg = () => window.APP_CONFIG;
const SESSION_KEY = "arc-to-staking-sheet-session";
export const redirectUri = () => new URL("oauth-callback.html", window.location.href).href;

export function restoreSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return null;
    const session = arcgisRest.ArcGISIdentityManager.deserialize(s);
    return session.tokenExpires && new Date(session.tokenExpires) < new Date() ? null : session;
  } catch { return null; }
}

export async function signIn() {
  const { clientId, portal } = cfg();
  const session = await arcgisRest.ArcGISIdentityManager.beginOAuth2({
    clientId, portal, redirectUri: redirectUri(), popup: true, pkce: true,
  });
  try { sessionStorage.setItem(SESSION_KEY, session.serialize()); } catch { /* private window */ }
  return session;
}

export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

const req = (session, url, params = {}) =>
  arcgisRest.request(url, { authentication: session, httpMethod: "GET", params: { f: "json", ...params } });

/** The signed-in user's profile (orgId, favGroupId, username...). */
export const getUser = (session) => session.getUser();

/** Link to an item's page in ArcGIS Online. */
export const itemPageUrl = (id) => cfg().portal.replace(/\/sharing\/rest\/?$/, "") + "/home/item.html?id=" + id;

/**
 * Searches web maps the user can see, like the Dashboards "data source" picker.
 * scope: "org" | "mine" | "favorites". Returns { items, nextStart } (nextStart -1 = no more pages).
 */
export async function searchWebMaps(session, user, { text = "", scope = "org", stakingOnly = false, start = 1 } = {}) {
  const words = text.replace(/[^\w\s#.-]/g, " ").trim();
  const parts = [];
  if (words) parts.push(`(${words})`);
  if (stakingOnly) parts.push("title:staking");
  if (scope === "mine") parts.push(`owner:"${user.username}"`);
  else if (scope === "favorites") parts.push(`group:${user.favGroupId}`);
  else parts.push(`orgid:${user.orgId}`);
  const params = { q: parts.join(" AND "), filter: 'type:"Web Map"', num: 40, start };
  if (!words) Object.assign(params, { sortField: "modified", sortOrder: "desc" });
  const res = await req(session, `${cfg().portal}/search`, params);
  const items = (res.results || []).filter((i) => i.type === "Web Map")
    .map((i) => ({ id: i.id, title: i.title, owner: i.owner, modified: i.modified, snippet: i.snippet }));
  return { items, nextStart: res.nextStart ?? -1, total: res.total ?? items.length };
}

/** Accepts a web map item URL, a Map Viewer URL, or a bare 32-character item ID. */
export function parseItemId(text) {
  const m = /(?:[?&#]|^)(?:id|webmap)=([0-9a-f]{32})/i.exec(text) || /\b([0-9a-f]{32})\b/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export async function loadWebMap(session, itemId) {
  const base = `${cfg().portal}/content/items/${itemId}`;
  const item = await req(session, base);
  if (item.type !== "Web Map") throw new Error(`That item is a "${item.type}", not a web map.`);
  const data = await req(session, `${base}/data`);
  const layers = {};
  const walk = (list) => {
    for (const l of list || []) {
      if (l.layerType === "ArcGISFeatureLayer" && l.url) layers[l.title] = l.url;
      walk(l.layers);
    }
  };
  walk(data.operationalLayers);
  return { title: item.title, layers };
}

/**
 * Field lists (with dropdown values) of the map's layers: { title: layerJson }. A few at a time.
 * Layers that can't be read are left out.
 */
export async function layerSchemas(session, layers, onProgress = () => {}) {
  const entries = Object.entries(layers);
  const out = {};
  let next = 0, done = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [title, url] = entries[next++];
      try { out[title] = await req(session, url); } catch { /* skipped */ }
      onProgress(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

/**
 * Count of features grouped by HoleNo + the given fields: one small query per layer.
 * Returns [{<field>: value, ..., n}] with the field names as the mapping wrote them.
 */
export async function groupedCounts(session, layerUrl, fields) {
  const info = await req(session, layerUrl);
  const actual = {};
  for (const f of info.fields || []) actual[f.name.toLowerCase()] = f.name;
  const missing = fields.filter((f) => !actual[f.toLowerCase()]);
  if (missing.length) {
    const err = new Error(`layer "${info.name}" has no ${missing.join(", ")} field` +
      (missing.includes(HOLE_FIELD) ? " (run Standardize_HoleNo on this web map)" : ""));
    err.missingFields = missing;
    throw err;
  }
  const oid = info.objectIdField || (info.fields.find((f) => f.type === "esriFieldTypeOID") || {}).name || "OBJECTID";
  const res = await req(session, `${layerUrl}/query`, {
    where: "1=1",
    groupByFieldsForStatistics: fields.map((f) => actual[f.toLowerCase()]).join(","),
    outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: oid, outStatisticFieldName: "n" }]),
    returnGeometry: false,
  });
  if (res.error) throw new Error(res.error.message || "query failed");
  return (res.features || []).map((ft) => {
    const lower = Object.fromEntries(Object.entries(ft.attributes).map(([k, v]) => [k.toLowerCase(), v]));
    const row = { n: Number(lower.n ?? 0) };
    for (const f of fields) row[f] = lower[f.toLowerCase()] ?? null;
    return row;
  });
}

/**
 * Object IDs of the features in one grouped row (exact attribute match, blanks included),
 * so a PM can find a flagged point in the map. Returns up to `limit` IDs plus the total.
 */
export async function objectIdsFor(session, layerUrl, attrs, limit = 25) {
  const info = await req(session, layerUrl);
  const actual = {};
  for (const f of info.fields || []) actual[f.name.toLowerCase()] = f.name;
  const clauses = Object.entries(attrs).map(([k, v]) => {
    const name = actual[k.toLowerCase()] || k;
    if (v === null || v === undefined) return `${name} IS NULL`;
    return typeof v === "number" ? `${name} = ${v}` : `${name} = '${String(v).replace(/'/g, "''")}'`;
  });
  const res = await req(session, `${layerUrl}/query`, { where: clauses.join(" AND ") || "1=1", returnIdsOnly: true });
  if (res.error) throw new Error(res.error.message || "query failed");
  const ids = (res.objectIds || []).sort((a, b) => a - b);
  return { ids: ids.slice(0, limit), total: ids.length, field: res.objectIdFieldName || info.objectIdField || "OBJECTID" };
}
