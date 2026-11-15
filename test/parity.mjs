// Test de fidélité : chaque réponse d'un outil france-mcp (appelé via un vrai client MCP en stdio)
// est comparée champ par champ à un appel direct, indépendant, de l'API officielle.
// Échantillon déterministe (graine fixe) : 600 communes, 600 entreprises, 600 avis BOAMP, 600 parcelles.
//
// Usage : npm run parity            (≈ 5 à 10 min, ~5 000 requêtes publiques, débit limité)
//         PARITY_N=50 npm run parity (essai rapide)
// Résultat : test/parity-result.json
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const N = Number(process.env.PARITY_N ?? 600);
const UA = { "User-Agent": "france-mcp-parity (+https://github.com/tbsrgt/france-mcp)" };

// --- aléatoire déterministe ---------------------------------------------------
let seed = 20261115;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const sample = (arr, n) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};

// --- limiteur de débit par hôte (requêtes directes) ------------------------------
const nextSlot = new Map();
const RATE = { "recherche-entreprises.api.gouv.fr": 220, "apicarto.ign.fr": 120 }; // ms entre deux requêtes
async function raw(url, as = "json") {
  const host = new URL(url).host;
  const gap = RATE[host] ?? 60;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + gap);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  for (let i = 0; i < 4; i++) {
    let res;
    try {
      res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) });
    } catch (err) {
      // erreur réseau ou délai dépassé côté source : on retente, comme pour un 5xx
      if (i === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return as === "json" ? res.json() : res.text();
  }
  throw new Error(`Échec répété ${url}`);
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// --- client MCP ----------------------------------------------------------------
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../src/index.js", import.meta.url).pathname], stderr: "ignore" });
const client = new Client({ name: "parity", version: "1.0.0" });
await client.connect(transport);
async function tool(name, args) {
  for (let i = 0; i < 3; i++) {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (!res.isError) return JSON.parse(res.content[0].text);
    if (i === 2 || !/HTTP (429|5\d\d)|timeout|aborted|fetch failed|ECONNRESET|socket/i.test(res.content[0].text)) throw new Error(res.content[0].text);
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
}

// --- comparaison -----------------------------------------------------------------
const results = {};
function compare(source, id, pairs) {
  const ecarts = pairs.filter(([, a, b]) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)).map(([champ, a, b]) => ({ champ, outil: a, officiel: b }));
  const r = (results[source] ??= { total: 0, identiques: 0, champs_compares: 0, ecarts: [] });
  r.total++;
  r.champs_compares += pairs.length;
  if (ecarts.length) r.ecarts.push({ id, ecarts });
  else r.identiques++;
}
const progress = (label, k, n) => {
  if ((k + 1) % 50 === 0 || k + 1 === n) process.stderr.write(`  ${label} ${k + 1}/${n}\n`);
};

// 1. Communes ---------------------------------------------------------------------
console.error("→ Communes (API Géo)");
const toutes = await raw("https://geo.api.gouv.fr/communes?fields=code&format=json");
const communes = sample(toutes.map((c) => c.code), N);
await pool(communes, 6, async (code, k) => {
  try {
    const [t, o] = await Promise.all([
      tool("communes_rechercher", { code_insee: code }),
      raw(`https://geo.api.gouv.fr/communes/${code}?fields=nom,code,codesPostaux,population,codeDepartement,codeRegion,codeEpci,siren`),
    ]);
    const c = t.resultats[0] ?? {};
    compare("communes", code, [
      ["code_insee", c.code_insee, o.code],
      ["nom", c.nom, o.nom],
      ["codes_postaux", c.codes_postaux, o.codesPostaux],
      ["population", c.population, o.population],
      ["departement", c.departement?.code, o.codeDepartement],
      ["region", c.region?.code, o.codeRegion],
      ["epci", c.epci?.siren, o.codeEpci],
      ["siren", c.siren, o.siren],
    ]);
  } catch (err) {
    compare("communes", code, [["erreur", err.message, null]]);
  }
  progress("communes", k, N);
});

// 2. Entreprises ------------------------------------------------------------------
console.error("→ Entreprises (Sirene / Annuaire des entreprises)");
const sirens = new Set();
for (const code of communes) {
  if (sirens.size >= N) break;
  const d = await raw(`https://recherche-entreprises.api.gouv.fr/search?code_commune=${code}&per_page=10`);
  for (const r of sample(d.results, 3)) if (sirens.size < N) sirens.add(r.siren);
}
const ETAT = { A: "active", C: "cessée", F: "fermée" };
await pool([...sirens], 3, async (siren, k) => {
  try {
    const t = await tool("entreprises_fiche", { siren });
    const d = await raw(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=5`);
    const o = d.results.find((x) => x.siren === siren) ?? {};
    const e = t.entreprise ?? {};
    compare("entreprises", siren, [
      ["siren", e.siren, o.siren],
      ["nom", e.nom, o.nom_complet],
      ["etat", e.etat, ETAT[o.etat_administratif] ?? o.etat_administratif],
      ["naf", e.naf, o.activite_principale],
      ["nature_juridique", e.nature_juridique, o.nature_juridique],
      ["date_creation", e.date_creation, o.date_creation],
      ["siret_siege", e.siege?.siret, o.siege?.siret],
      ["code_postal_siege", e.siege?.code_postal, o.siege?.code_postal],
      ["commune_siege", e.siege?.code_commune, o.siege?.commune],
    ]);
  } catch (err) {
    compare("entreprises", siren, [["erreur", err.message, null]]);
  }
  progress("entreprises", k, sirens.size);
});

// 3. BOAMP ---------------------------------------------------------------------------
console.error("→ Avis BOAMP");
const BOAMP = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const ids = [];
for (let offset = 0; ids.length < N * 3 && offset < 2000; offset += 100) {
  const d = await raw(`${BOAMP}?select=idweb&order_by=dateparution%20desc&limit=100&offset=${offset}`);
  ids.push(...d.results.map((r) => r.idweb));
}
const avis = sample([...new Set(ids)], N);
await pool(avis, 5, async (id, k) => {
  try {
    const [t, d] = await Promise.all([
      tool("marches_avis", { id }),
      raw(`${BOAMP}?where=${encodeURIComponent(`idweb="${id}"`)}&limit=1`),
    ]);
    const o = d.results[0] ?? {};
    const a = t.avis ?? {};
    compare("boamp", id, [
      ["id", a.id, o.idweb],
      ["objet", a.objet, o.objet],
      ["acheteur", a.acheteur, o.nomacheteur],
      ["nature", a.nature, o.nature_libelle],
      ["date_parution", a.date_parution, o.dateparution],
      ["date_limite_reponse", a.date_limite_reponse ?? null, o.datelimitereponse ?? null],
      ["departements", a.departements, o.code_departement],
      ["url", a.url, o.url_avis],
    ]);
  } catch (err) {
    compare("boamp", id, [["erreur", err.message, null]]);
  }
  progress("boamp", k, N);
});

// 4. Cadastre --------------------------------------------------------------------------
// Parcelles tirées des ventes DVF de communes de l'échantillon, puis comparées à API Carto interrogée directement.
console.error("→ Parcelles cadastrales (IGN)");
const parcellesDvf = new Set();
for (const code of communes) {
  if (parcellesDvf.size >= N * 1.3) break;
  const dep = code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2);
  let text = "";
  try {
    text = await raw(`https://files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/${dep}/${code}.csv`, "text");
  } catch {
    continue;
  }
  const lignes = text.split("\n").slice(1);
  const col = text.split("\n")[0].split(",").indexOf("id_parcelle");
  const idsCommune = [...new Set(lignes.map((l) => l.split(",")[col]).filter((x) => x && x.length === 14))];
  for (const p of sample(idsCommune, 8)) parcellesDvf.add(p);
}
let retenues = 0;
const candidates = [...parcellesDvf];
await pool(candidates, 4, async (idu) => {
  if (retenues >= N) return;
  const code_insee = idu.slice(0, 5);
  const section = idu.slice(8, 10);
  const numero = idu.slice(10, 14);
  let o;
  try {
    o = await raw(`https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${code_insee}&section=${section}&numero=${numero}`);
  } catch {
    return; // référence officielle injoignable : la parcelle n'entre pas dans l'échantillon
  }
  const officielle = o.features.find((f) => f.properties.idu === idu);
  if (!officielle || retenues >= N) return; // parcelle renumérotée depuis la vente : hors échantillon
  retenues++;
  try {
    const t = await tool("cadastre_parcelle", { code_insee, section: section.replace(/^0/, ""), numero: String(Number(numero)) });
    const p = t.resultats.find((x) => x.id === idu) ?? {};
    const op = officielle.properties;
    compare("cadastre", idu, [
      ["id", p.id, op.idu],
      ["code_insee", p.code_insee, op.code_insee],
      ["commune", p.commune, op.nom_com],
      ["section", p.section, op.section],
      ["numero", p.numero, op.numero],
      ["surface_m2", p.surface_m2, op.contenance],
    ]);
  } catch (err) {
    compare("cadastre", idu, [["erreur", err.message, null]]);
  }
  if (retenues % 50 === 0 && retenues) process.stderr.write(`  cadastre ${retenues}/${N}\n`);
});

await client.close();

const total = Object.values(results).reduce((s, r) => s + r.total, 0);
const identiques = Object.values(results).reduce((s, r) => s + r.identiques, 0);
const champs = Object.values(results).reduce((s, r) => s + r.champs_compares, 0);
const out = {
  date: new Date().toISOString(),
  total,
  identiques,
  champs_compares: champs,
  graine: 20261115,
  par_source: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { total: r.total, identiques: r.identiques, champs_compares: r.champs_compares }])),
  ecarts: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.ecarts.slice(0, 50)])),
};
writeFileSync(new URL("./parity-result.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${identiques} / ${total} réponses identiques à la source officielle (${champs} champs comparés)`);
for (const [k, r] of Object.entries(out.par_source)) console.log(`  ${k.padEnd(12)} ${r.identiques}/${r.total}`);
process.exit(identiques === total ? 0 : 1);
