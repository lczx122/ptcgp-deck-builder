#!/usr/bin/env python3
"""Probe pokemonmeta.com to discover its card API and image URL scheme.

We can't reach the site from the dev sandbox (proxy blocks non-GitHub hosts),
so this runs in CI where the runner has open internet. It hits a set of
candidate endpoints, prints status + a sample card object + guessed
set/number/image fields, so we can build the real downloader against facts.

Run locally or in CI:  python scripts/pokemonmeta_probe.py
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

CARD_ENDPOINTS = [
    "https://www.pokemonmeta.com/api/v1/cards?limit=3",
    "https://www.pokemonmeta.com/api/v2/cards?limit=3",
    "https://www.pokemonmeta.com/api/cards?limit=3",
    "https://www.pokemonmeta.com/pocket/api/v1/cards?limit=3",
    "https://pokemonmeta.com/api/v1/cards?limit=3",
]
SET_ENDPOINTS = [
    "https://www.pokemonmeta.com/api/v1/sets",
    "https://www.pokemonmeta.com/api/v1/set",
    "https://www.pokemonmeta.com/api/v1/collections",
    "https://www.pokemonmeta.com/api/v1/expansions",
]

IMAGE_HINT = ("image", "img", "art", "artwork", "picture", "cardImage", "src", "url")
SET_HINT = ("set", "expansion", "collection", "series", "pack")
NUM_HINT = ("number", "num", "cardnumber", "no", "id", "cardid")


def get(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, resp.headers.get("Content-Type", ""), body
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", e.read()[:400]
    except Exception as e:  # noqa: BLE001
        return None, "", repr(e).encode()


def show_fields(obj: dict):
    keys = list(obj.keys())
    print(f"    field names ({len(keys)}): {', '.join(keys)}")
    for hint_name, hints in (("set?", SET_HINT), ("number?", NUM_HINT), ("image?", IMAGE_HINT)):
        matches = [k for k in keys if any(h in k.lower() for h in hints)]
        print(f"    {hint_name:8} candidates: {matches}")
    # Any value that looks like an image URL or filename.
    for k, v in obj.items():
        sv = str(v)
        if any(sv.lower().endswith(ext) for ext in (".webp", ".png", ".jpg")) or "http" in sv[:8]:
            print(f"    url-ish field {k!r}: {sv[:120]}")


def probe_cards():
    print("=== CARD ENDPOINTS ===")
    for url in CARD_ENDPOINTS:
        status, ctype, body = get(url)
        print(f"\n[{status}] {url}   ({ctype})")
        if status != 200 or "json" not in ctype.lower():
            print(f"    body head: {body[:200]!r}")
            continue
        try:
            data = json.loads(body)
        except Exception as e:  # noqa: BLE001
            print(f"    JSON parse failed: {e}")
            continue
        rows = data if isinstance(data, list) else data.get("cards") or data.get("data") or data
        if isinstance(rows, list) and rows:
            print(f"    got {len(rows)} rows; first object:")
            print("    " + json.dumps(rows[0], ensure_ascii=False)[:1500])
            if isinstance(rows[0], dict):
                show_fields(rows[0])
        else:
            print(f"    unexpected shape: {json.dumps(data)[:400]}")


def probe_sets():
    print("\n=== SET / COLLECTION ENDPOINTS ===")
    for url in SET_ENDPOINTS:
        status, ctype, body = get(url)
        print(f"\n[{status}] {url}   ({ctype})")
        if status == 200 and "json" in ctype.lower():
            try:
                data = json.loads(body)
                print("    " + json.dumps(data, ensure_ascii=False)[:1200])
            except Exception:
                print(f"    body head: {body[:200]!r}")
        else:
            print(f"    body head: {body[:160]!r}")


if __name__ == "__main__":
    probe_cards()
    probe_sets()
    print("\n=== done ===")
