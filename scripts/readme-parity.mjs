// Injecte les résultats de test/parity-result.json dans le README (entre les marqueurs parity:start / parity:end).
import { readFileSync, writeFileSync } from "node:fs";
const r = JSON.parse(readFileSync(new URL("../test/parity-result.json", import.meta.url), "utf8"));
const fr = (n) => n.toLocaleString("fr-FR").replace(/ /g, " ");
const LABELS = {
  communes: ["Communes", "API Géo", "nom, codes postaux, population, département, région, EPCI, SIREN"],
  entreprises: ["Entreprises", "Annuaire des Entreprises", "SIREN, nom, état, NAF, forme juridique, date de création, SIRET, code postal et commune du siège"],
  boamp: ["Avis de marchés", "BOAMP", "objet, acheteur, nature, dates de parution et limite, départements, URL"],
  cadastre: ["Parcelles", "IGN API Carto", "identifiant, commune, section, numéro, surface"],
};
const rows = Object.entries(r.par_source).map(([k, v]) => `| ${LABELS[k][0]} | ${LABELS[k][1]} | ${fr(v.identiques)} / ${fr(v.total)} | ${LABELS[k][2]} |`);
const table = [
  "<!-- parity:start -->",
  "| Échantillon | Source comparée | Identiques | Champs vérifiés |",
  "|---|---|---|---|",
  ...rows,
  `| **Total** | | **${fr(r.identiques)} / ${fr(r.total)}** | ${fr(r.champs_compares)} champs comparés le ${r.date.slice(0, 10)} |`,
  "<!-- parity:end -->",
].join("\n");
const p = new URL("../README.md", import.meta.url);
let s = readFileSync(p, "utf8");
s = s.includes("<!-- parity:start -->") ? s.replace(/<!-- parity:start -->[\s\S]*?<!-- parity:end -->/, table) : s.replace("__PARITY_TABLE__", table);
s = s.replace(/fid%C3%A9lit%C3%A9-[^)]*?-0055A4/, `fid%C3%A9lit%C3%A9-${encodeURIComponent(`${r.identiques}/${r.total}`)}-0055A4`).replace("__PARITY_BADGE__", encodeURIComponent(`${r.identiques}/${r.total}`));
writeFileSync(p, s);
console.log(`README mis à jour : ${r.identiques}/${r.total}`);
