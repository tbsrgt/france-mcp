// Liste des groupes d'outils (« toolsets »). Chaque outil : { name, title, description, input, run }.
import * as entreprises from "./tools/entreprises.js";
import * as territoires from "./tools/territoires.js";
import * as immobilier from "./tools/immobilier.js";
import * as marches from "./tools/marches.js";
import * as datagouv from "./tools/datagouv.js";
import * as energie from "./tools/energie.js";
import * as services from "./tools/services.js";
import * as batiment from "./tools/batiment.js";
import * as legifrance from "./tools/legifrance.js";

export const TOOLSETS = {
  entreprises: { label: "Entreprises (Sirene, RNE)", tools: entreprises.tools },
  territoires: { label: "Adresses et communes (BAN, API Géo)", tools: territoires.tools },
  immobilier: { label: "Cadastre et ventes immobilières (IGN, DVF)", tools: immobilier.tools },
  batiment: { label: "Risques (Géorisques) et DPE (ADEME)", tools: batiment.tools },
  marches: { label: "Marchés publics (BOAMP)", tools: marches.tools },
  datagouv: { label: "Catalogue data.gouv.fr", tools: datagouv.tools },
  energie: { label: "Raccordement électrique EnR (Caparéseau)", tools: energie.tools },
  services: { label: "Services publics et jours fériés", tools: services.tools },
  legifrance: { label: "Droit français (Légifrance, clé PISTE)", tools: legifrance.tools, enabled: legifrance.enabled },
};

/** Sélectionne les outils actifs. `wanted` : liste de noms de toolsets, ou vide pour tout. */
export function selectTools(wanted = []) {
  const unknown = wanted.filter((w) => !TOOLSETS[w]);
  if (unknown.length) throw new Error(`Toolset inconnu : ${unknown.join(", ")}. Disponibles : ${Object.keys(TOOLSETS).join(", ")}`);
  const names = wanted.length ? wanted : Object.keys(TOOLSETS);
  const active = [];
  const skipped = [];
  for (const name of names) {
    const set = TOOLSETS[name];
    if (set.enabled && !set.enabled()) {
      skipped.push(name);
      continue;
    }
    active.push(...set.tools.map((t) => ({ ...t, toolset: name })));
  }
  return { tools: active, skipped };
}

export const allTools = () => Object.entries(TOOLSETS).flatMap(([toolset, s]) => s.tools.map((t) => ({ ...t, toolset })));
