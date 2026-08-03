# Datamine engine

A small pipeline that extracts card images and card data from a Pokémon TCG
Pocket **APK** (or a directory of its Unity asset bundles) and normalizes them
into the same `cards.json` shape the web app already consumes.

It exists as a **fallback / independent source**: the app's primary data still
comes from the upstream `pokemon-tcg-pocket-database` community project (see the
root README). Use this when you want to pull a brand-new set straight from the
game before upstream catches up, or to verify upstream against the source.

## What it does

```
 app.apk ──▶ extract.py ──▶ ./out/            inspect_dump.py ──▶ (you read this)
             │                ├── images/*.webp      │
             │                ├── text/*.json        ▼
             │                ├── mono/*.json    edit mapping.json
             │                └── manifest.json      │
             │                                       ▼
             └──────────────────────────▶ normalize.py ──▶ ./out/cards.json
```

1. **`extract.py`** — game-agnostic. Walks every Unity bundle in the APK/XAPK/zip
   (recursing into split-APK XAPKs) or a directory, and exports every
   `Texture2D`/`Sprite` → webp, `TextAsset` → raw json/bytes, `MonoBehaviour` →
   type-tree json. Writes `manifest.json` indexing everything.
2. **`inspect_dump.py`** — helps you find *which* dumped objects hold the card
   table, by scoring objects whose fields look card-shaped and printing the most
   common field names.
3. **edit `mapping.json`** — point the game's real field names at the app schema
   (`set`, `number`, `name`, `rarity`, `element`, `type`). This is the only part
   that changes between game versions; the code stays put.
4. **`normalize.py`** — applies the mapping and writes `cards.json`, ready
   to drop into `public/data/`.

## Install & run

```bash
pip install -r datamine/requirements.txt

python datamine/extract.py path/to/PokemonTCGPocket.apk --out ./out
python datamine/inspect_dump.py ./out            # find the card table
# edit datamine/mapping.json based on what you saw
python datamine/normalize.py ./out               # -> ./out/cards.json
```

Run the self-tests (no APK or UnityPy needed for these):

```bash
python datamine/test_pipeline.py
```

## Getting an APK

**You supply the APK.** This tool deliberately does not download game binaries —
random APK mirrors are a common malware vector. Get it from a device you control:

- Install the game from the official store on an Android device/emulator, then
  pull the split APKs with `adb`:
  ```bash
  adb shell pm path jp.pokemon.pokemontcgp     # package id may differ by region
  adb pull <each path shown>
  ```
  Zip the resulting `base.apk` + `split_*.apk` together as an `.xapk`, or just
  point `extract.py` at the folder of pulled APKs.

Only datamine a game you have legitimately installed, and keep in mind the card
artwork and data are © Nintendo / The Pokémon Company / Creatures / DeNA — this
is for personal/community tooling, not redistribution of their assets.

## When the APK is nearly empty

Most modern gacha games — very likely TCG Pocket included — ship a thin APK and
**download the bulk of their assets (addressables) from a CDN at first launch**.
If `extract.py` reports `bundles: 0` or finds no card art, the cards aren't in
the APK. In that case, extract from the on-device download cache instead:

```bash
# after launching the game once so it downloads assets:
adb shell 'run-as <package.id> ls -R files' | less     # find the bundle cache
adb pull /sdcard/Android/data/<package.id>/files/ ./bundles
python datamine/extract.py ./bundles --out ./out
```

`extract.py` treats a directory exactly like an APK, so the rest of the pipeline
is unchanged.

## Known hard cases

- **Encrypted bundles** (UnityCN or a custom cipher): UnityPy will fail to load
  them and `extract.py` records the error in `manifest.json → load_errors`. These
  need the game's key/decryption, which is out of scope here.
- **Obfuscated field names**: if `MonoBehaviour` keys are hashed, `inspect_dump`
  can't name them for you — you'll map fields positionally by inspecting a few
  known cards. The mapping-json design supports this without code changes.
- **Image naming**: the app expects `cards-by-set/{set}/{number}.webp`. A helper
  to rename/rehost extracted art to that layout is a natural next step once we
  see how the real dump names its textures.
