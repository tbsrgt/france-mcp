// Exécute les vrais outils france-mcp et enregistre leurs sorties brutes dans data.json.
// Les défauts zod ne sont pas appliqués quand on appelle run() directement : tous les arguments sont explicites.
// Usage : node assets/_demo/fetch-data.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { allTools } from "../../src/registry.js";

const tools = Object.fromEntries(allTools().map((t) => [t.name, t]));
const call = async (name, args) => {
  const t0 = Date.now();
  const out = await tools[name].run(args);
  return { name, args, ms: Date.now() - t0, out };
};

const geo = await call("adresse_geocoder", { adresse: "Rousset", code_postal: "13790", limite: 1 });
const g = geo.out.resultats[0];
const postes = await call("energie_postes_sources", { latitude: g.latitude, longitude: g.longitude, rayon_km: 20, limite: 5 });
const dvf = await call("dvf_statistiques", { code_insee: g.code_insee, depuis: 2021 });
const ao = await call("marches_rechercher", { mots_cles: "photovoltaïque", departement: "13", nature: "avis_de_marche", ouverts_seulement: true, limite: 5, decalage: 0 });

const data = { date: new Date().toISOString(), calls: [geo, postes, dvf, ao] };
await writeFile(fileURLToPath(new URL("./data.json", import.meta.url)), JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, (k, v) => (k === "resultats" && Array.isArray(v) && v.length > 8 ? v.slice(0, 3) : v), 2).slice(0, 9000));
