// Légifrance (DILA) via la plateforme PISTE. Nécessite une clé gratuite :
// https://piste.gouv.fr → créer une application, souscrire à l'API Légifrance,
// puis définir PISTE_CLIENT_ID et PISTE_CLIENT_SECRET.
import { z } from "zod";
import { request } from "../http.js";

const OAUTH = "https://oauth.piste.gouv.fr/api/oauth/token";
const API = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
const SOURCE = { nom: "Légifrance (DILA, via PISTE)", url: "https://www.legifrance.gouv.fr" };

let token = null;

export const enabled = () => Boolean(process.env.PISTE_CLIENT_ID && process.env.PISTE_CLIENT_SECRET);

async function getToken() {
  if (token && token.expires > Date.now() + 30000) return token.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.PISTE_CLIENT_ID,
    client_secret: process.env.PISTE_CLIENT_SECRET,
    scope: "openid",
  });
  const data = await request(OAUTH, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: false,
  });
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function post(path, payload) {
  return request(`${API}${path}`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
    cache: false,
  });
}

const strip = (s) => (typeof s === "string" ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : s);

const FONDS = {
  codes: "CODE_DATE",
  lois_decrets: "LODA_DATE",
  journal_officiel: "JORF",
  jurisprudence_judiciaire: "JURI",
  jurisprudence_administrative: "CETAT",
  conventions_collectives: "KALI",
  cnil: "CNIL",
};

export const tools = [
  {
    name: "legifrance_rechercher",
    title: "Rechercher dans le droit français",
    description:
      "Recherche plein texte dans Légifrance : codes en vigueur, lois et décrets, Journal officiel, jurisprudence (Cour de cassation, Conseil d'État), conventions collectives, délibérations CNIL. Renvoie titres, extraits et identifiants d'articles (LEGIARTI…) à lire avec legifrance_article.",
    input: {
      recherche: z.string().min(2),
      fond: z.enum(Object.keys(FONDS)).default("codes"),
      page: z.number().int().min(1).default(1),
      par_page: z.number().int().min(1).max(50).default(10),
    },
    async run({ recherche, fond, page, par_page }) {
      const data = await post("/search", {
        fond: FONDS[fond],
        recherche: {
          champs: [
            {
              typeChamp: "ALL",
              operateur: "ET",
              criteres: [{ typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP", valeur: recherche, operateur: "ET" }],
            },
          ],
          filtres: [],
          pageNumber: page,
          pageSize: par_page,
          operateur: "ET",
          sort: "PERTINENCE",
          typePagination: "DEFAUT",
        },
      });
      return {
        source: SOURCE,
        total: data.totalResultNumber,
        resultats: (data.results ?? []).map((r) => ({
          titres: (r.titles ?? []).map((t) => ({ id: t.id, cid: t.cid, titre: strip(t.title) })),
          nature: r.nature ?? undefined,
          date: r.date ?? undefined,
          etat: r.etat ?? undefined,
          extraits: (r.sections ?? [])
            .flatMap((s) => (s.extracts ?? []).map((e) => ({ id: e.id, num: e.num, titre: strip(s.title), texte: strip((e.values ?? []).join(" … ")) })))
            .slice(0, 5),
        })),
      };
    },
  },
  {
    name: "legifrance_article",
    title: "Lire un article de loi",
    description: "Texte intégral et version en vigueur d'un article de code ou de loi à partir de son identifiant Légifrance (LEGIARTI000…).",
    input: { id: z.string().regex(/^(LEGI|JORF|KALI)ARTI\d{12}$/).describe("Identifiant d'article, ex. LEGIARTI000006419280") },
    async run({ id }) {
      const data = await post("/consult/getArticle", { id });
      const a = data.article ?? {};
      return {
        source: SOURCE,
        id: a.id,
        numero: a.num,
        etat: a.etat,
        en_vigueur_depuis: a.dateDebut ? new Date(a.dateDebut).toISOString().slice(0, 10) : undefined,
        jusqu_au: a.dateFin ? new Date(a.dateFin).toISOString().slice(0, 10) : undefined,
        texte_parent: a.textTitles?.map((t) => strip(t.titre)) ?? undefined,
        texte: strip(a.texteHtml ?? a.texte),
        url: a.id ? `https://www.legifrance.gouv.fr/codes/article_lc/${a.id}` : undefined,
      };
    },
  },
];
