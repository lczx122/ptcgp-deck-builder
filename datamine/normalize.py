#!/usr/bin/env python3
"""Turn an extracted dump into cards.extra.json matching the web app's schema.

The web app consumes objects shaped like the community database:
    { "set", "number", "name", "rarity", "image", "element", "type", ... }

The game's internal field names differ and change between versions, so the
mapping is data-driven: edit datamine/mapping.json (created on first run) to point
at the real field names you found with inspect_dump.py. This keeps the code stable
across game updates — only the JSON mapping changes.

Pipeline:
    1. extract.py         -> ./out (images + text + mono + manifest)
    2. inspect_dump.py    -> discover the card table + field names
    3. edit mapping.json  -> map game fields -> app schema
    4. normalize.py       -> ./out/cards.extra.json  (drop into public/data/)

Usage:
    python normalize.py ./out                       # uses datamine/mapping.json
    python normalize.py ./out --mapping my.json --out-file cards.extra.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

DEFAULT_MAPPING = {
    "_comment": "Map the game's field names (right) onto the app schema (left). "
                "Run inspect_dump.py to discover the real names, then edit this file. "
                "'source' picks the card table: a TextAsset json file (text/...) or "
                "'mono' to gather individual MonoBehaviour card objects.",
    "source": "text/REPLACE_ME.json",
    "rows_path": "",  # dotted path to the array inside the JSON, "" if top-level list
    "fields": {
        "set": "expansionCode",
        "number": "cardNumber",
        "name": "nameKey",
        "rarity": "rarity",
        "element": "energyType",
        "type": "cardType",
    },
    "value_maps": {
        "element": {"0": "grass", "1": "fire", "2": "water", "3": "lightning",
                     "4": "psychic", "5": "fighting", "6": "darkness", "7": "metal",
                     "8": "colorless"},
        "type": {"0": "pokemon", "1": "trainer"}
    },
    "image_pattern": "cPK_{set}_{number}.webp",
}


def load_mapping(path: Path) -> dict:
    if not path.exists():
        path.write_text(json.dumps(DEFAULT_MAPPING, indent=2, ensure_ascii=False))
        raise SystemExit(
            f"Wrote a starter mapping to {path}.\n"
            "Edit it to match the field names inspect_dump.py found, then re-run."
        )
    return json.loads(path.read_text())


def dig(obj, dotted: str):
    if not dotted:
        return obj
    for part in dotted.split("."):
        if isinstance(obj, dict):
            obj = obj.get(part)
        else:
            return None
    return obj


def load_rows(out: Path, mapping: dict) -> list[dict]:
    source = mapping["source"]
    if source == "mono":
        manifest = json.loads((out / "manifest.json").read_text())
        rows = []
        for obj in manifest["objects"]:
            if obj["kind"] == "mono":
                data = json.loads((out / obj["file"]).read_text())
                rows.append(data)
        return rows
    data = json.loads((out / source).read_text(encoding="utf-8", errors="replace"))
    rows = dig(data, mapping.get("rows_path", "")) or data
    if not isinstance(rows, list):
        raise SystemExit(f"Source {source} rows_path did not resolve to a list.")
    return rows


def apply_value_map(value, vmap: dict | None):
    if vmap is None:
        return value
    return vmap.get(str(value), value)


def normalize(out: Path, mapping: Path, out_file: str) -> int:
    cfg = load_mapping(mapping)
    rows = load_rows(out, cfg)
    fields = cfg["fields"]
    value_maps = cfg.get("value_maps", {})
    pattern = cfg.get("image_pattern", "cPK_{set}_{number}.webp")

    cards = []
    skipped = 0
    for row in rows:
        card = {}
        ok = True
        for app_field, game_field in fields.items():
            raw = dig(row, game_field)
            if raw is None and app_field in ("set", "number", "name"):
                ok = False
                break
            card[app_field] = apply_value_map(raw, value_maps.get(app_field))
        if not ok:
            skipped += 1
            continue
        card.setdefault("image", pattern.format(**{k: card.get(k, "") for k in card}))
        cards.append(card)

    dest = out / out_file
    dest.write_text(json.dumps(cards, ensure_ascii=False, indent=2))
    print(f"Wrote {len(cards)} cards -> {dest}  ({skipped} rows skipped for missing keys)")
    if cards:
        print("Sample:", json.dumps(cards[0], ensure_ascii=False))
    return len(cards)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path, help="the extract.py output directory")
    ap.add_argument("--mapping", type=Path, default=Path(__file__).parent / "mapping.json")
    ap.add_argument("--out-file", default="cards.extra.json", help="output filename inside `out`")
    args = ap.parse_args(argv)
    normalize(args.out, args.mapping, args.out_file)


if __name__ == "__main__":
    main()
