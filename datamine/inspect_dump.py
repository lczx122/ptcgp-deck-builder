#!/usr/bin/env python3
"""Explore an extracted dump to find where card data lives.

extract.py produces a game-agnostic pile of images/text/mono JSON. Before you can
normalize it into card records you need to know *which* MonoBehaviours/TextAssets
hold the card table. This tool surfaces likely candidates by:

  * ranking MonoBehaviour objects whose keys look card-shaped
    (name/cardId/rarity/set/expansion/energy/hp...)
  * scanning TextAssets for JSON/CSV that parses into rows with those fields
  * summarising the shape of the best candidates so you can wire up normalize.py

Usage:
    python inspect_dump.py ./out                # summary of best candidates
    python inspect_dump.py ./out --show mono/Foo__123.json   # dump one object
    python inspect_dump.py ./out --keyword rarity            # search by field
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

# Fields that, if present, strongly suggest an object is a card (or card table).
CARD_HINTS = {
    "cardid", "card_id", "cardno", "cardnumber", "number", "name", "namekey",
    "rarity", "rarityid", "set", "setid", "expansion", "expansioncode",
    "energy", "energytype", "element", "type", "hp", "health", "retreat",
    "weakness", "stage", "evolvesfrom", "illustrator", "artist",
}


def _tokens(keys) -> set[str]:
    return {str(k).lower().replace("m_", "").replace("_", "") for k in keys}


def score_keys(keys) -> int:
    toks = _tokens(keys)
    return sum(1 for hint in CARD_HINTS if any(hint.replace("_", "") in t for t in toks))


def load_manifest(out: Path) -> dict:
    path = out / "manifest.json"
    if not path.exists():
        raise SystemExit(f"No manifest at {path}. Run extract.py first.")
    return json.loads(path.read_text())


def rank_mono(out: Path, manifest: dict, top: int):
    rows = []
    for obj in manifest["objects"]:
        if obj["kind"] != "mono":
            continue
        score = score_keys(obj.get("keys", []))
        if score:
            rows.append((score, obj))
    rows.sort(key=lambda r: r[0], reverse=True)
    return rows[:top]


def scan_text(out: Path, manifest: dict, top: int):
    """Find TextAssets that parse as JSON arrays/objects of card-shaped rows."""
    hits = []
    for obj in manifest["objects"]:
        if obj["kind"] != "text":
            continue
        path = out / obj["file"]
        if not path.exists() or not path.suffix == ".json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        rows = data if isinstance(data, list) else data.get("cards") if isinstance(data, dict) else None
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            score = score_keys(rows[0].keys())
            if score:
                hits.append((score, len(rows), obj, sorted(rows[0].keys())[:20]))
    hits.sort(key=lambda h: (h[0], h[1]), reverse=True)
    return hits[:top]


def summarise(out: Path, manifest: dict, top: int):
    stats = manifest.get("stats", {})
    print("Dump summary")
    print("  " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    print()

    mono = rank_mono(out, manifest, top)
    print(f"Top {len(mono)} card-shaped MonoBehaviours:")
    if not mono:
        print("  (none — card data may be in TextAssets, or keys are obfuscated)")
    for score, obj in mono:
        print(f"  [{score:2}] {obj['file']}  name={obj['name']!r}")
        print(f"        keys: {', '.join(obj.get('keys', [])[:16])}")
    print()

    text = scan_text(out, manifest, top)
    print(f"Top {len(text)} card-shaped TextAsset tables:")
    if not text:
        print("  (none)")
    for score, count, obj, keys in text:
        print(f"  [{score:2}] {obj['file']}  rows≈{count}")
        print(f"        fields: {', '.join(keys)}")
    print()

    # Global key frequency across mono objects — helps spot the real field names.
    counter = Counter()
    for obj in manifest["objects"]:
        if obj["kind"] == "mono":
            counter.update(obj.get("keys", []))
    print("Most common MonoBehaviour keys (for mapping in normalize.py):")
    for key, freq in counter.most_common(25):
        print(f"  {freq:5}  {key}")


def show(out: Path, rel: str):
    path = out / rel
    if not path.exists():
        raise SystemExit(f"No such file: {path}")
    text = path.read_text(encoding="utf-8", errors="replace")
    print(text[:20000])
    if len(text) > 20000:
        print(f"\n... ({len(text)} chars total, truncated)")


def keyword(out: Path, manifest: dict, term: str):
    term_l = term.lower()
    print(f"Objects whose name or keys mention {term!r}:")
    for obj in manifest["objects"]:
        hay = (obj.get("name", "") + " " + " ".join(obj.get("keys", []))).lower()
        if term_l in hay:
            print(f"  {obj['kind']:5} {obj['file']}  name={obj['name']!r}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path, help="the extract.py output directory")
    ap.add_argument("--top", type=int, default=10, help="how many candidates to show")
    ap.add_argument("--show", metavar="REL", help="print one dumped file (e.g. mono/Foo__12.json)")
    ap.add_argument("--keyword", metavar="TERM", help="list objects mentioning TERM")
    args = ap.parse_args(argv)

    if args.show:
        show(args.out, args.show)
        return
    manifest = load_manifest(args.out)
    if args.keyword:
        keyword(args.out, manifest, args.keyword)
        return
    summarise(args.out, manifest, args.top)


if __name__ == "__main__":
    main()
