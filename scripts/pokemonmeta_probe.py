#!/usr/bin/env python3
"""Probe #2: discover pokemonmeta's card-image URL convention and confirm B4.

The API (https://www.pokemonmeta.com/api/v1/cards) returns cards with a
`pokemonId` like "A1-017" (set + number) but no image URL. This finds the
image path by (a) scraping /pkm_img/ references from the cards page HTML and
(b) brute-forcing candidate URL patterns for a known card and a B4 card.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE = "https://www.pokemonmeta.com"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get("Content-Type", "") if e.headers else ""), b""
    except Exception as e:  # noqa: BLE001
        return None, "", repr(e).encode()


def head_size(url):
    """Return (status, content-type, size) for a candidate image URL."""
    status, ctype, body = get(url)
    return status, ctype, len(body) if body else 0


def parse_pokemon_id(pid):
    # "A1-017" -> ("A1", "017", 17); "B4-001" -> ("B4","001",1)
    m = re.match(r"^([A-Za-z0-9]+)-(\d+)$", pid or "")
    if not m:
        return None
    return m.group(1), m.group(2), int(m.group(2))


def candidate_urls(card):
    pid = card["pokemonId"]
    set_code, num3, num = parse_pokemon_id(pid)
    oid = card["_id"]
    us = pid.replace("-", "_")
    pats = [
        f"{BASE}/pkm_img/Cards/{pid}.webp",
        f"{BASE}/pkm_img/cards/{pid}.webp",
        f"{BASE}/pkm_img/Cards/{us}.webp",
        f"{BASE}/pkm_img/Cards/{set_code}/{num3}.webp",
        f"{BASE}/pkm_img/Cards/{set_code}/{num}.webp",
        f"{BASE}/pkm_img/Cards/{set_code}-{num3}.webp",
        f"{BASE}/pkm_img/Cards/{oid}.webp",
        f"{BASE}/pkm_img/cards/{oid}.webp",
        f"{BASE}/pkm_img/Cards/{pid}_EN.webp",
        f"{BASE}/pkm_img/Cards/{set_code}_{num3}_EN.webp",
        f"{BASE}/pkm_img/Cards/{pid}.png",
    ]
    return pats


def main():
    print("=== FETCH FULL CARD LIST ===")
    status, ctype, body = get(f"{BASE}/api/v1/cards?limit=6000")
    print(f"[{status}] /api/v1/cards?limit=6000 ({ctype}) {len(body)} bytes")
    cards = json.loads(body)
    print(f"total cards returned: {len(cards)}")

    sets = {}
    for c in cards:
        pid = c.get("pokemonId", "")
        parsed = parse_pokemon_id(pid)
        if parsed:
            sets.setdefault(parsed[0], 0)
            sets[parsed[0]] += 1
    print("sets present (code: count):")
    for s in sorted(sets):
        print(f"    {s:8} {sets[s]}")

    b4 = [c for c in cards if (c.get("pokemonId") or "").startswith("B4-")]
    print(f"\nB4 cards in pokemonmeta data: {len(b4)}")
    control = next((c for c in cards if c.get("pokemonId") == "A1-017"), cards[0])
    samples = [control] + (b4[:1] if b4 else [])

    print("\n=== SCRAPE /pkm_img/ REFERENCES FROM HTML PAGES ===")
    for page in (f"{BASE}/cards", f"{BASE}/pocket", f"{BASE}/pocket/cards"):
        status, ctype, body = get(page)
        html = body.decode("utf-8", "replace") if body else ""
        refs = sorted(set(re.findall(r"/pkm_img/[^\"'<>\\)\s]+", html)))
        card_refs = [r for r in refs if "card" in r.lower()]
        print(f"[{status}] {page} — {len(refs)} pkm_img refs, {len(card_refs)} with 'card':")
        for r in (card_refs or refs)[:12]:
            print(f"    {r}")

    print("\n=== BRUTE-FORCE CANDIDATE CARD IMAGE URLS ===")
    for card in samples:
        print(f"\ncard {card['pokemonId']} (_id={card['_id']}, name={card['name']}):")
        for url in candidate_urls(card):
            status, ctype, size = head_size(url)
            hit = "  <== IMAGE" if (status == 200 and "image" in (ctype or "").lower()) else ""
            print(f"    [{status}] {ctype:24} {size:7}b  {url}{hit}")

    print("\n=== done ===")


if __name__ == "__main__":
    main()
