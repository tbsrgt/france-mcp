// Génère assets/demo.gif (+ assets/demo-poster.png) à partir de scene.html.
//
//   node assets/_demo/build.mjs            utilise data.json (sorties réelles déjà enregistrées)
//   node assets/_demo/build.mjs --refresh  relance d'abord les vrais outils (fetch-data.mjs)
//
// Chiffre de l'acte 3 : test/parity-result.json s'il existe, sinon assets/_demo/parity-sample.json (essai).
import { existsSync, readdirSync } from "node:fs";
import { readFile, rm, mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import puppeteer from "puppeteer-core";
import { selectTools } from "../../src/registry.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT_GIF = join(ROOT, "assets", "demo.gif");
const OUT_POSTER = join(ROOT, "assets", "demo-poster.png");
const FRAMES = join(HERE, ".frames");
const FPS = 12.5; // délai GIF de 8 centièmes
const W = 1200, H = 760;

if (process.argv.includes("--refresh")) {
  execFileSync(process.execPath, [join(HERE, "fetch-data.mjs")], { stdio: ["ignore", "ignore", "inherit"], cwd: ROOT });
}

// ---------- Données réelles des outils ----------
const data = JSON.parse(await readFile(join(HERE, "data.json"), "utf8"));
const byName = Object.fromEntries(data.calls.map((c) => [c.name, c]));
const geo = byName.adresse_geocoder, postes = byName.energie_postes_sources, dvf = byName.dvf_statistiques, ao = byName.marches_rechercher;

const dec = (n) => String(n).replace(".", ",");
const ent = (n) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");
const dateFr = (iso) => iso.slice(0, 10).split("-").reverse().join("/");
const em = (s) => `<em>${String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</em>`;

const g = geo.out.resultats[0];
const besoinMw = 5;
const dispo = (p) => p.capacite_restant_a_affecter_mw ?? 0;
const proches = postes.out.resultats.filter((p) => dispo(p) > 0).slice(0, 2);
const majs = proches.map((p) => p.mise_a_jour).filter(Boolean);
const lastYear = (type) => {
  const s = dvf.out.statistiques[type] ?? {};
  const y = Object.keys(s).sort().at(-1);
  return y ? { annee: y, ...s[y] } : null;
};
const maison = lastYear("Maison"), appart = lastYear("Appartement");
const avis = ao.out.resultats;

const DEMO = {
  nbOutils: selectTools([]).tools.length,
  question:
    "Je veux poser 5 MW de solaire près de Rousset (13). Y a-t-il de la capacité réseau, combien coûte le foncier, et quels appels d’offres photovoltaïque sont ouverts dans le 13 ?",
  questionShort: "5 MW de solaire près de Rousset (13) : réseau, foncier, appels d’offres ?",
  before:
    "Je n’ai pas accès à des données à jour sur le réseau électrique, les prix du foncier ou les marchés publics. Pour la capacité de raccordement, consultez Caparéseau ; pour les prix, les données DVF ; pour les appels d’offres, le BOAMP.",
  chipsLabel: "à interroger et recouper à la main :",
  chips: ["BAN", "API Géo", "Caparéseau", "DVF", "BOAMP"],
  calls: [
    {
      name: geo.name,
      args: `adresse: "${geo.args.adresse}", code_postal: "${geo.args.code_postal}"`,
      ms: geo.ms,
      result: `${em(`${g.commune} (${g.code_postal})`)} · INSEE ${em(g.code_insee)} · ${g.latitude}, ${g.longitude}`,
    },
    {
      name: postes.name,
      args: `latitude: ${postes.args.latitude}, longitude: ${postes.args.longitude}, rayon_km: ${postes.args.rayon_km}`,
      ms: postes.ms,
      result:
        `${em(postes.out.total)} postes à moins de ${postes.args.rayon_km} km · ` +
        proches.map((p) => `${p.nom} ${em(dec(dispo(p)) + " MW")}`).join(" · ") + " dispo",
    },
    {
      name: dvf.name,
      args: `code_insee: "${dvf.args.code_insee}"`,
      ms: dvf.ms,
      result:
        `${dvf.out.commune} ${maison?.annee ?? ""} · ` +
        [maison && `maison ${em(ent(maison.prix_m2_median) + " €/m²")} (${maison.ventes} ventes)`, appart && `appartement ${em(ent(appart.prix_m2_median) + " €/m²")}`]
          .filter(Boolean)
          .join(" · "),
    },
    {
      name: ao.name,
      args: `mots_cles: "${ao.args.mots_cles}", departement: "${ao.args.departement}", ouverts_seulement: true`,
      ms: ao.ms,
      result: `${em(ao.out.total)} avis ouvert${ao.out.total > 1 ? "s" : ""}` + (avis[0] ? ` · ${avis[0].id} · ${avis[0].acheteur}` : ""),
    },
  ],
  answer: {
    lead: proches.some((p) => dispo(p) >= besoinMw)
      ? `Oui, la capacité réseau est là pour ${besoinMw} MW :`
      : `Capacité réseau limitée près de ${g.commune} :`,
    items: [
      `Réseau : ` + proches.map((p) => `${p.nom} (${dec(p.distance_km)} km) ${dec(dispo(p))} MW`).join(" et ") +
        ` restant à affecter ; quote-part S3REnR ${dec(proches[0]?.quote_part_keur_par_mw)} k€/MW.`,
      maison ? `Foncier : à ${dvf.out.commune}, maison ${ent(maison.prix_m2_median)} €/m² médian en ${maison.annee} (${maison.ventes} ventes DVF).` : `Foncier : pas de vente DVF exploitable.`,
      `Appels d’offres PV ouverts dans le ${ao.args.departement} : ${ao.out.total}` +
        (avis[0] ? ` — ${avis[0].acheteur}, réponse avant le ${dateFr(avis[0].date_limite_reponse)}.` : "."),
    ],
    src: `Sources : Caparéseau${majs.length ? ` (MAJ ${majs.sort((a, b) => b.split("/").reverse().join("").localeCompare(a.split("/").reverse().join("")))[0]})` : ""} · DVF (DGFiP) · BOAMP${avis[0] ? " " + avis[0].id : ""} · BAN`,
  },
};

// ---------- Parité (jamais codée en dur) ----------
const realParity = join(ROOT, "test", "parity-result.json");
const parityFile = existsSync(realParity) ? realParity : join(HERE, "parity-sample.json");
const parity = JSON.parse(await readFile(parityFile, "utf8"));
if (!Number.isFinite(parity.total) || !Number.isFinite(parity.identiques)) throw new Error(`${parityFile} : champs total / identiques manquants`);
const isSample = parityFile !== realParity;
const sources = Object.entries(parity.par_source ?? {}).slice(0, 8).map(([nom, v]) => ({
  nom,
  val: typeof v === "number" ? ent(v) : v && Number.isFinite(v.identiques) && Number.isFinite(v.total) ? `${ent(v.identiques)}/${ent(v.total)}` : "",
}));
DEMO.parity = {
  total: parity.total,
  identiques: parity.identiques,
  champs: Number.isFinite(parity.champs_compares) ? parity.champs_compares : 0,
  sources,
  foot: isSample
    ? "aperçu : données d’essai (parity-sample.json)"
    : `france-mcp · ${DEMO.nbOutils} outils, sans clé API${parity.date ? ` · contrôle du ${dateFr(String(parity.date))}` : ""}`,
};
console.log(`Parité : ${parity.identiques}/${parity.total} lus dans ${parityFile.replace(ROOT + "/", "")}${isSample ? "  (ESSAI : test/parity-result.json absent)" : ""}`);

// ---------- Rendu des frames ----------
function findBrowser() {
  const cands = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const dir = join(homedir(), ".cache", "puppeteer", kind);
    if (!existsSync(dir)) continue;
    for (const v of readdirSync(dir).sort().reverse()) {
      cands.push(join(dir, v, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
      cands.push(join(dir, v, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
    }
  }
  cands.push("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/usr/bin/google-chrome", "/usr/bin/chromium");
  const found = cands.find((p) => p && existsSync(p));
  if (!found) throw new Error("Aucun Chrome/Chromium trouvé : définissez CHROME_PATH.");
  return found;
}

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ["--hide-scrollbars", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((d) => { window.DEMO = d; }, DEMO);
await page.goto(pathToFileURL(join(HERE, "scene.html")).href, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
const fontOk = await page.evaluate(() => document.fonts.check('22px "JetBrains Mono"'));
if (!fontOk) console.warn("JetBrains Mono non chargée (hors ligne ?) : repli sur Menlo.");
const duration = await page.evaluate(() => window.DURATION);
const n = Math.round(duration * FPS);
const posterT = await page.evaluate(() => window.POSTER_T);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: join(FRAMES, `${String(i).padStart(4, "0")}.png`) });
}
await page.evaluate((t) => window.render(t), posterT);
await page.screenshot({ path: OUT_POSTER });
await browser.close();

// ---------- Assemblage GIF ----------
const ffmpeg = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(FRAMES, "%04d.png"),
  "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  "-loop", "0", OUT_GIF,
], { stdio: "inherit" });
await rm(FRAMES, { recursive: true, force: true });
const size = (await stat(OUT_GIF)).size;
console.log(`OK ${OUT_GIF.replace(ROOT + "/", "")} : ${(size / 1024 / 1024).toFixed(2)} Mo, ${n} images, ${duration} s, ${W}x${H}`);
if (size > 6 * 1024 * 1024) console.warn("Attention : GIF > 6 Mo.");
