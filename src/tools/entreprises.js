// Annuaire des entreprises (Sirene + RNE) via recherche-entreprises.api.gouv.fr — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const API = "https://recherche-entreprises.api.gouv.fr/search";
const SOURCE = { nom: "Annuaire des Entreprises (INSEE Sirene, INPI RNE)", url: "https://annuaire-entreprises.data.gouv.fr" };

const ETAT = { A: "active", C: "cessée", F: "fermée" };

export function formatEntreprise(r, { detail = false } = {}) {
  const s = r.siege ?? {};
  const out = {
    siren: r.siren,
    nom: r.nom_complet,
    sigle: r.sigle ?? undefined,
    etat: ETAT[r.etat_administratif] ?? r.etat_administratif,
    naf: r.activite_principale,
    section_activite: r.section_activite_principale,
    categorie: r.categorie_entreprise ?? undefined,
    nature_juridique: r.nature_juridique,
    tranche_effectif: r.tranche_effectif_salarie ?? undefined,
    date_creation: r.date_creation,
    date_fermeture: r.date_fermeture ?? undefined,
    siege: {
      siret: s.siret,
      adresse: s.adresse,
      code_postal: s.code_postal,
      commune: s.libelle_commune,
      code_commune: s.commune,
      departement: s.departement,
      latitude: s.latitude ? Number(s.latitude) : undefined,
      longitude: s.longitude ? Number(s.longitude) : undefined,
    },
    nombre_etablissements_ouverts: r.nombre_etablissements_ouverts,
    fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
  };
  if (detail) {
    out.tva_intracom = r.tva?.numero ?? undefined;
    out.dirigeants = (r.dirigeants ?? []).map((d) =>
      d.type_dirigeant === "personne morale"
        ? { denomination: d.denomination, siren: d.siren, qualite: d.qualite }
        : { nom: d.nom, prenoms: d.prenoms, qualite: d.qualite },
    );
    out.finances = r.finances ?? undefined;
    const c = r.complements ?? {};
    out.labels = Object.entries(c)
      .filter(([k, v]) => k.startsWith("est_") && v === true)
      .map(([k]) => k.slice(4));
    out.conventions_collectives = s.liste_idcc ?? undefined;
    out.rge = s.liste_rge ?? undefined;
  }
  return out;
}

export const tools = [
  {
    name: "entreprises_rechercher",
    title: "Rechercher des entreprises",
    description:
      "Recherche dans le répertoire Sirene de toutes les entreprises françaises (nom, SIREN, SIRET, dirigeant, adresse). Filtres : code postal, département, code NAF, état. Renvoie SIREN, siège, activité, effectif.",
    input: {
      q: z.string().min(1).describe("Texte libre : nom, SIREN, SIRET, nom de dirigeant ou adresse"),
      code_postal: z.string().regex(/^\d{5}$/).optional().describe("Code postal du siège ou d'un établissement, ex. 13001"),
      departement: z.string().regex(/^(\d{2,3}|2A|2B)$/).optional().describe("Numéro de département, ex. 13, 2A, 974"),
      code_naf: z.string().regex(/^\d{2}\.\d{2}[A-Z]$/).optional().describe("Code NAF/APE, ex. 43.21A"),
      seulement_actives: z.boolean().default(true).describe("Exclure les entreprises cessées"),
      page: z.number().int().min(1).default(1),
      par_page: z.number().int().min(1).max(25).default(10),
    },
    async run({ q, code_postal, departement, code_naf, seulement_actives, page, par_page }) {
      const data = await getJson(
        buildUrl(API, {
          q,
          code_postal,
          departement,
          activite_principale: code_naf,
          etat_administratif: seulement_actives ? "A" : undefined,
          page,
          per_page: par_page,
        }),
      );
      return {
        source: SOURCE,
        total: data.total_results,
        page: data.page,
        pages: data.total_pages,
        resultats: data.results.map((r) => formatEntreprise(r)),
      };
    },
  },
  {
    name: "entreprises_fiche",
    title: "Fiche entreprise complète",
    description:
      "Fiche détaillée d'une entreprise à partir de son SIREN (9 chiffres) ou SIRET (14 chiffres) : identité, siège, dirigeants, chiffre d'affaires et résultat publiés, TVA, labels (RGE, ESS, Qualiopi, bio…), conventions collectives.",
    input: {
      siren: z
        .string()
        .transform((s) => s.replace(/\s/g, ""))
        .pipe(z.string().regex(/^(\d{9}|\d{14})$/, "SIREN (9 chiffres) ou SIRET (14 chiffres)"))
        .describe("SIREN ou SIRET, espaces acceptés"),
    },
    async run({ siren }) {
      const id = siren.slice(0, 9);
      const data = await getJson(buildUrl(API, { q: id, per_page: 5 }));
      const r = data.results.find((x) => x.siren === id);
      if (!r) return { source: SOURCE, trouve: false, message: `Aucune entreprise avec le SIREN ${id} (ou diffusion restreinte).` };
      return { source: SOURCE, trouve: true, entreprise: formatEntreprise(r, { detail: true }) };
    },
  },
];
