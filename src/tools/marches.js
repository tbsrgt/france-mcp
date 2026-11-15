// Marchés publics : BOAMP (DILA), via l'API Opendatasoft officielle — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const SOURCE = { nom: "BOAMP — Bulletin officiel des annonces des marchés publics (DILA)", url: "https://www.boamp.fr" };

const FIELDS =
  "idweb,objet,nomacheteur,famille_libelle,nature_libelle,procedure_libelle,type_marche,descripteur_libelle,code_departement,dateparution,datelimitereponse,titulaire,url_avis";

/** Échappe une valeur pour une chaîne ODSQL entre guillemets doubles. */
const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const NATURES = { avis_de_marche: "APPEL_OFFRE", attribution: "ATTRIBUTION", rectificatif: "RECTIFICATIF", annulation: "ANNULATION" };

export function formatAvis(r) {
  return {
    id: r.idweb,
    objet: r.objet,
    acheteur: r.nomacheteur,
    nature: r.nature_libelle,
    famille: r.famille_libelle,
    procedure: r.procedure_libelle,
    type_marche: r.type_marche,
    descripteurs: r.descripteur_libelle,
    departements: r.code_departement,
    date_parution: r.dateparution,
    date_limite_reponse: r.datelimitereponse ?? undefined,
    titulaires: r.titulaire ?? undefined,
    url: r.url_avis,
  };
}

export const tools = [
  {
    name: "marches_rechercher",
    title: "Rechercher des appels d'offres publics",
    description:
      "Cherche dans tous les avis du BOAMP (appels d'offres, attributions, rectificatifs) depuis 2015. Filtres : mots-clés dans l'objet, département, type de marché, acheteur, titulaire, dates, seulement les marchés encore ouverts. Renvoie objet, acheteur, date limite et lien vers l'avis.",
    input: {
      mots_cles: z.string().optional().describe("Recherche plein texte dans l'objet, ex. « photovoltaïque toiture »"),
      departement: z.string().regex(/^(\d{1,3}|2A|2B)$/).optional().describe("Code département, ex. 13 (sans zéro initial pour 01 à 09 : 1, 2…)"),
      nature: z.enum(["avis_de_marche", "attribution", "rectificatif", "annulation", "tous"]).default("avis_de_marche"),
      type_marche: z.enum(["TRAVAUX", "SERVICES", "FOURNITURES"]).optional(),
      acheteur: z.string().optional().describe("Texte contenu dans le nom de l'acheteur public"),
      titulaire: z.string().optional().describe("Entreprise attributaire (avis d'attribution)"),
      ouverts_seulement: z.boolean().default(false).describe("Uniquement les avis dont la date limite de réponse n'est pas passée"),
      publie_depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date de parution minimale AAAA-MM-JJ"),
      limite: z.number().int().min(1).max(100).default(20),
      decalage: z.number().int().min(0).max(9900).default(0).describe("Pagination"),
    },
    async run({ mots_cles, departement, nature, type_marche, acheteur, titulaire, ouverts_seulement, publie_depuis, limite, decalage }) {
      const where = [];
      if (mots_cles) where.push(`search(objet, ${q(mots_cles)})`);
      if (departement) where.push(`code_departement = ${q(departement.replace(/^0(?=\d$)/, ""))}`);
      if (nature !== "tous") where.push(`nature = ${q(NATURES[nature])}`);
      if (type_marche) where.push(`type_marche = ${q(type_marche)}`);
      if (acheteur) where.push(`search(nomacheteur, ${q(acheteur)})`);
      if (titulaire) where.push(`search(titulaire, ${q(titulaire)})`);
      if (ouverts_seulement) where.push("datelimitereponse >= now()");
      if (publie_depuis) where.push(`dateparution >= date'${publie_depuis}'`);
      const data = await getJson(
        buildUrl(API, {
          select: FIELDS,
          where: where.join(" AND ") || undefined,
          order_by: "dateparution desc",
          limit: limite,
          offset: decalage,
        }),
      );
      return { source: SOURCE, total: data.total_count, resultats: data.results.map(formatAvis) };
    },
  },
  {
    name: "marches_avis",
    title: "Détail d'un avis BOAMP",
    description:
      "Contenu complet d'un avis du BOAMP à partir de son identifiant (ex. 26-110845) : acheteur, contact, lots, critères, durée, montant, procédure, modalités de réponse.",
    input: {
      id: z.string().regex(/^\d{2}-\d{1,7}$/).describe("Identifiant BOAMP (idweb), ex. 26-110845"),
    },
    async run({ id }) {
      const data = await getJson(buildUrl(API, { where: `idweb = ${q(id)}`, limit: 1 }));
      const r = data.results[0];
      if (!r) return { source: SOURCE, trouve: false, message: `Aucun avis ${id}.` };
      let contenu = r.donnees;
      try {
        contenu = JSON.parse(r.donnees);
      } catch {
        /* texte brut */
      }
      let texte = JSON.stringify(contenu);
      const tronque = texte.length > 30000;
      if (tronque) texte = texte.slice(0, 30000);
      return {
        source: SOURCE,
        trouve: true,
        avis: formatAvis(r),
        criteres: r.criteres ?? undefined,
        contenu: tronque ? texte : contenu,
        tronque: tronque || undefined,
      };
    },
  },
];
