// Test de bout en bout : lance le serveur en stdio, appelle chaque outil sur les vraies API publiques.
// Usage : npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CASES = [
  ["entreprises_rechercher", { q: "michelin", departement: "63", par_page: 3 }, (r) => r.resultats.length > 0 && /^\d{9}$/.test(r.resultats[0].siren)],
  ["entreprises_fiche", { siren: "855 200 507" }, (r) => r.trouve && r.entreprise.siren === "855200507"],
  ["adresse_geocoder", { adresse: "20 avenue de Ségur Paris" }, (r) => r.resultats[0]?.code_insee?.startsWith("751")],
  ["adresse_inverse", { latitude: 43.2965, longitude: 5.3698 }, (r) => r.resultats[0]?.commune === "Marseille"],
  ["communes_rechercher", { code_postal: "13400" }, (r) => r.resultats.some((c) => c.code_insee === "13005")],
  ["territoire_lister", { niveau: "departements", parent: "93" }, (r) => r.total === 6],
  ["cadastre_parcelle", { latitude: 48.8566, longitude: 2.3522 }, (r) => r.resultats[0]?.id?.length === 14],
  ["dvf_ventes", { code_insee: "13005", type_bien: "Maison", limite: 3 }, (r) => r.total > 0 && r.resultats[0].valeur_fonciere > 0],
  ["dvf_statistiques", { code_insee: "33063", depuis: 2024 }, (r) => r.statistiques.Appartement["2024"]?.prix_m2_median > 1000],
  ["risques_adresse", { latitude: 43.2947, longitude: 5.565 }, (r) => r.risques_naturels.presents.length > 0],
  ["dpe_rechercher", { latitude: 43.2947, longitude: 5.565, rayon_m: 150, etiquettes: ["F", "G"], limite: 3 }, (r) => r.total > 0 && r.resultats.every((x) => ["F", "G"].includes(x.etiquette_energie))],
  ["marches_rechercher", { mots_cles: "photovoltaïque", limite: 3 }, (r) => r.total > 0],
  ["marches_avis", null, (r) => r.trouve], // id injecté depuis le cas précédent
  ["datagouv_rechercher", { recherche: "prix des carburants", par_page: 3 }, (r) => r.total > 0],
  ["datagouv_jeu_de_donnees", { id: "base-adresse-nationale" }, (r) => r.ressources.length > 0],
  ["datagouv_apercu", { ressource_id: "d368c882-bb1f-429a-86c1-021e5c01fdf6", par_page: 2 }, (r) => r.lignes.length > 0],
  ["energie_postes_sources", { latitude: 43.45, longitude: 5.69, rayon_km: 25, limite: 3 }, (r) => r.postes_charges > 1000 && r.resultats.length > 0],
  ["services_publics_trouver", { code_insee: "13005", type: "mairie" }, (r) => r.resultats[0]?.telephone?.length > 0],
  ["jours_feries", { annee: 2026 }, (r) => r.jours.some((j) => j.date === "2026-07-14")],
];

const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../src/index.js", import.meta.url).pathname], stderr: "ignore" });
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

let ok = 0;
let lastBoampId;
for (const [name, input, check] of CASES) {
  const args = name === "marches_avis" ? { id: lastBoampId } : input;
  const t0 = performance.now();
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) throw new Error(text);
    const data = JSON.parse(text);
    if (name === "marches_rechercher") lastBoampId = data.resultats[0]?.id;
    const pass = check(data);
    if (pass) ok++;
    console.log(`${pass ? "✔" : "✘"} ${name.padEnd(26)} ${Math.round(performance.now() - t0)} ms`);
    if (!pass) console.log("   ", text.slice(0, 300));
  } catch (err) {
    console.log(`✘ ${name.padEnd(26)} ${err.message.slice(0, 200)}`);
  }
}
await client.close();
console.log(`\n${ok}/${CASES.length} outils OK`);
process.exit(ok === CASES.length ? 0 : 1);
