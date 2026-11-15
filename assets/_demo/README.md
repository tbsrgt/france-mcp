# Sources de `assets/demo.gif`

Animation du README en trois actes : agent sans outils, même agent avec france-mcp, puis résultat de parité.

- `fetch-data.mjs` appelle les vrais outils (`allTools()` de `src/registry.js`) et enregistre leurs sorties dans `data.json`. Tous les chiffres de l'acte 2 viennent de ce fichier.
- `scene.html` dessine une image pour un instant `t` (`window.render(t)`).
- `build.mjs` produit les images avec Chrome headless (puppeteer-core) puis assemble le GIF avec ffmpeg (palettegen/paletteuse). Il écrit `assets/demo.gif` et `assets/demo-poster.png`.
- Acte 3 : le chiffre est lu dans `test/parity-result.json` (`npm run parity`). Si ce fichier manque, `parity-sample.json` sert d'essai et le GIF l'indique en pied de page.

## Régénérer

```sh
cd assets/_demo && npm install && cd ../..   # une fois (puppeteer-core en local)
node assets/_demo/build.mjs --refresh        # relance les outils, puis le GIF
node assets/_demo/build.mjs                  # GIF seul, à partir de data.json
```

Prérequis : ffmpeg, et Chrome ou Chromium (détecté automatiquement, sinon `CHROME_PATH=...`). La police JetBrains Mono vient de Google Fonts, donc il faut être en ligne.
