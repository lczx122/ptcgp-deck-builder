#!/usr/bin/env python3
"""Self-tests for the datamine pipeline that run without a real APK.

These cover the parts that don't need UnityPy or game files: archive walking,
Unity-magic sniffing, the inspector's card-shape scoring, and normalize's
field-mapping + value-maps. Run:

    python datamine/test_pipeline.py
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import extract  # noqa: E402
import inspect_dump  # noqa: E402
import normalize  # noqa: E402


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_unity_sniff():
    assert extract._looks_like_unity(b"UnityFS\x00rest of header")
    assert not extract._looks_like_unity(b"just some text")
    print("ok  unity magic sniff")


def test_zip_walk_finds_bundles_and_recurses_xapk():
    inner_apk = _make_zip({
        "assets/bin/Data/level0": b"UnityFS\x00payload-a",
        "res/drawable/icon.png": b"\x89PNG not-unity",
    })
    xapk = _make_zip({
        "base.apk": inner_apk,
        "manifest.json": b"{}",
        "assets/sharedassets0.assets": b"UnityFS\x00payload-b",
    })
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "game.xapk"
        path.write_bytes(xapk)
        found = {name: data for name, data in extract.iter_unity_blobs(path)}
    unity_payloads = [d for d in found.values() if d.startswith(b"UnityFS")]
    assert len(unity_payloads) == 2, f"expected 2 bundles, got {len(unity_payloads)}"
    assert not any(b"not-unity" in d for d in found.values()), "png leaked through"
    print("ok  zip walk + xapk recursion")


def test_dir_walk():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "sub").mkdir()
        (root / "sub" / "bundle0").write_bytes(b"UnityFS\x00abc")
        (root / "notes.txt").write_bytes(b"hello world this is not unity data")
        found = {name: data for name, data in extract.iter_unity_blobs(root)}
    assert any(d.startswith(b"UnityFS") for d in found.values())
    print("ok  directory walk")


def test_inspector_scoring():
    card_keys = ["m_Name", "cardId", "rarity", "expansionCode", "energyType", "hp"]
    noise_keys = ["m_Name", "m_LocalPosition", "m_Father", "m_Children"]
    assert inspect_dump.score_keys(card_keys) >= 4
    assert inspect_dump.score_keys(noise_keys) <= 1
    print("ok  inspector card-shape scoring")


def test_normalize_maps_fields_and_values():
    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        (out / "text").mkdir()
        table = [
            {"expansionCode": "A1", "cardNumber": 1, "nameKey": "Bulbasaur",
             "rarity": "C", "energyType": 0, "cardType": 0},
            {"expansionCode": "A1", "cardNumber": 2, "nameKey": "Ivysaur",
             "rarity": "C", "energyType": 0, "cardType": 0},
            {"cardNumber": 3},  # missing set+name -> skipped
        ]
        (out / "text" / "cards.json").write_text(json.dumps(table))
        mapping = out / "mapping.json"
        cfg = json.loads(json.dumps(normalize.DEFAULT_MAPPING))
        cfg["source"] = "text/cards.json"
        mapping.write_text(json.dumps(cfg))

        count = normalize.normalize(out, mapping, "cards.json")
        cards = json.loads((out / "cards.json").read_text())

    assert count == 2, f"expected 2 cards, got {count}"
    assert cards[0]["element"] == "grass", cards[0]
    assert cards[0]["type"] == "pokemon", cards[0]
    assert cards[0]["set"] == "A1" and cards[0]["number"] == 1
    print("ok  normalize field + value mapping")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\nAll {len(tests)} datamine self-tests passed.")


if __name__ == "__main__":
    main()
