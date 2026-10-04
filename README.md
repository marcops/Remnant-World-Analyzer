# Remnant World Analyzer

Shows what rolled in your **Remnant: From the Ashes** world (campaign and adventure), what each event drops, **what you already have (✔) and what you're missing (✘)**, and a per-world summary of what's left — Earth, Subject 2923, Rhom, Corsus, Yaesha, Reisum, Ward 13, Ward 17, Ward Prime — with a description of how to obtain each item.

Fork of [hzla/Remnant-World-Analyzer](https://github.com/hzla/Remnant-World-Analyzer), with a rewritten parser (the original showed nothing for saves with an active adventure).

## How to use

### Automatic (Windows) — recommended
1. Download the project (`git clone`, or *Code → Download ZIP* and extract it).
2. Double-click **`Start.bat`**.
3. The browser opens on its own with your save already loaded. Keep the black window open: **the page refreshes by itself whenever the game saves**.

The script looks in `%LOCALAPPDATA%\Remnant\Saved\SaveGames` (Steam/Epic). If your saves are somewhere else:

```bat
Start.bat -SaveDir "D:\My saves\Remnant"
```

Other options: `-Port 9000` (different port), `-NoBrowser` (don't open the browser).

> If Windows shows "Windows protected your PC" when opening the `.bat` from a ZIP download, click *More info → Run anyway*. The script only reads the save folder and serves the page on `http://localhost` — nothing leaves your PC.

### Manual (any OS, nothing to install)
1. Open `index.html` in your browser.
2. Drag `save_N.sav` **and** `profile.sav` onto the page (or click and press `Ctrl+A` in the folder).
   - Folder: `%LOCALAPPDATA%\Remnant\Saved\SaveGames` (paste it into the file dialog's address bar).
   - `save_0.sav` is character 1, `save_1.sav` is character 2, and so on.
   - Without `profile.sav` the page shows the world but can't tell what you already have.

> A web page on its own can't read that folder automatically: Chrome/Edge block websites from accessing `AppData`. That's why the automatic mode uses `Start.bat`.

## What you get

- **Current world** — campaign and adventure, each event with location, type and items. Click an item to see *how to obtain* it. Filters by world, event type, item category, search and "only events with a missing item".
- **Missing items** — one card per world ("Corsus: 12 missing · 4 obtainable now"). Click a card to filter. Items that drop in your current world come first, tagged **available now**, with the exact location. Items bought in Ward 13 are under **Ward 13**; achievements and items with no world are under **General / achievements**.
- Mods that come built into weapons (e.g. Skewer on the Devastator) count as yours when you have the weapon.
- **Skins and consumables** are shown as a reference list: the save doesn't store them in a way that can be checked.

## For developers

```
index.html, css/app.css, js/app.js   page
js/parser.js                          save and profile parsing (runs in the browser and in Node)
js/data.js                            GENERATED — items, events, locations
tools/build-data.mjs                  generates js/data.js from tools/source/
tools/overrides.mjs                   manual name → game path fixes
js/wiki.js                            GENERATED — Fextralife wiki page of each item
tools/build-wiki.ps1                  generates js/wiki.js, keeping only pages that exist
server.ps1, Start.bat                 local server for automatic mode
test/parser.test.mjs                  tests
```

```sh
node tools/build-data.mjs --download --report   # re-download the sheet and regenerate js/data.js
powershell -ExecutionPolicy Bypass -File tools/build-wiki.ps1   # re-check item wiki pages (after build-data)
node --test test/                              # data and parser tests
RWA_SAVE=path/save_0.sav RWA_PROFILE=path/profile.sav node --test test/   # + with your own save
```

`--report` lists sheet items that couldn't be linked to a game path, and game paths with no item; fix them in `tools/overrides.mjs`.

## Credits

- [hzla/Remnant-World-Analyzer](https://github.com/hzla/Remnant-World-Analyzer) — the original project.
- [Razzmatazzz/RemnantSaveManager](https://github.com/Razzmatazzz/RemnantSaveManager) — the campaign, adventure and inventory parsing logic was ported from it, and `tools/source/GameInfo.xml` (events → items) comes from it.
- [Remnant: From the Ashes — Completionist's Checklist](https://docs.google.com/spreadsheets/d/1rmmwn-kaVS44qWgub7ubXqL26fAgM7TBIi-dNc7VGdI) by **Amythyst34** — full list of items, worlds, modes, DLC and "How to Obtain" (`tools/source/sheet-*.csv`).
- [Remnant: From the Ashes Wiki](https://remnantfromtheashes.wiki.fextralife.com/) by **Fextralife** — the item and location pages linked by the 🌐 icons (`js/wiki.js`).
- Forks with fixes and ideas: [axllency](https://github.com/axllency/Remnant-World-Analyzer), [tkerzmann](https://github.com/tkerzmann/Remnant-World-Analyzer), [paige404](https://github.com/paige404/Remnant-World-Analyzer), [gmferise](https://github.com/gmferise/Remnant-World-Analyzer), [northy](https://github.com/northy/Remnant-World-Analyzer), [chris-faulkner](https://github.com/chris-faulkner/Remnant-World-Analyzer).
- /u/FAOAB on Reddit, for the [name spreadsheet](https://docs.google.com/spreadsheets/d/1VzmDx0ZXQWN5N_9_zP0gEqToyuB9ZjlxgZOEGdiuA6A) used by the original.

## License

GPL-3.0 (see `LICENSE`), because it includes code and data ported from RemnantSaveManager, which is GPL-3.0.
