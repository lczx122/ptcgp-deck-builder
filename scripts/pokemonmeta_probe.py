#!/usr/bin/env python3
"""Probe #3: check LimitlessTCG's Pocket image CDN for B4 + hotlink behavior.

pokemonmeta references a `limitlessId` per card, so LimitlessTCG is the real
card-art host. Verify: (a) does the CDN have B4 art, (b) at what URL pattern,
(c) is it hotlink-protected (does it 403 when the Referer is our GitHub Pages
site rather than limitlesstcg.com)? If it serves cross-origin, we can point
<img> straight at it — no re-hosting needed.
"""
from __future__ import annotations

import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Candidate CDN bases and URL shapes for Pocket card art.
BASES = [
    "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket",
    "https://limitlesstcg.nyc3.digitaloceanspaces.com/pocket",
    "https://r2.limitlesstcg.net/pocket",
]


def shapes(base, set_code, num):
    n3 = f"{num:03d}"
    return [
        f"{base}/{set_code}/{set_code}_{n3}_EN.webp",
        f"{base}/{set_code}/{set_code}_{num}_EN.webp",
        f"{base}/{set_code}/{n3}.webp",
        f"{base}/{set_code}/{set_code}_{n3}_EN.png",
    ]


def fetch(url, referer=None):
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), len(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get("Content-Type", "") if e.headers else ""), 0
    except Exception as e:  # noqa: BLE001
        return None, repr(e), 0


def main():
    print("=== FIND A WORKING URL SHAPE (control: A1 #1, #17) ===")
    working = None
    for base in BASES:
        for (sc, num) in (("A1", 1), ("A1", 17)):
            for url in shapes(base, sc, num):
                status, ctype, size = fetch(url)
                ok = status == 200 and "image" in (ctype or "").lower()
                print(f"    [{status}] {ctype:20} {size:7}b  {url}{'  <== OK' if ok else ''}")
                if ok and not working:
                    working = url.replace("A1", "{set}").replace("001", "{n3}").replace("017", "{n3}")
        if working:
            break

    print(f"\nworking shape: {working!r}")
    if not working:
        print("No Limitless URL shape worked; stopping.")
        return

    print("\n=== DOES B4 EXIST? (try several B4 numbers) ===")
    base = BASES[0]
    for num in (1, 2, 3, 10, 50, 100):
        # reconstruct with the working base/shape (assume _EN.webp 3-digit)
        url = f"{base}/B4/B4_{num:03d}_EN.webp"
        status, ctype, size = fetch(url)
        print(f"    [{status}] {ctype:20} {size:7}b  {url}")

    print("\n=== HOTLINK PROTECTION? (B4 #1 with different Referers) ===")
    test = f"{base}/A1/A1_001_EN.webp"
    for label, ref in (("no referer", None),
                        ("our site", "https://lczx122.github.io/"),
                        ("limitless", "https://pocket.limitlesstcg.com/")):
        status, ctype, size = fetch(test, referer=ref)
        print(f"    {label:12} -> [{status}] {ctype} {size}b")

    print("\n=== done ===")


if __name__ == "__main__":
    main()
