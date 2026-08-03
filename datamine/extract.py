#!/usr/bin/env python3
"""Generic Unity asset extractor for Pokémon TCG Pocket (and other Unity games).

Given an APK / XAPK / zip / directory, this walks every Unity asset bundle it can
find and exports:

  * Texture2D and Sprite objects  -> images/<name>.webp   (+ .png if requested)
  * TextAsset objects             -> text/<name>.<ext>     (raw bytes)
  * MonoBehaviour objects         -> mono/<name>.json      (type-tree dict)

It also writes a manifest.json indexing every exported object, so the normalize
step (and you) can find card data without re-scanning the bundles.

This layer is game-agnostic: it does not assume anything about how TCG Pocket
lays out its cards. Turning the raw dump into card records is normalize.py's job.

Usage:
    python extract.py path/to/app.apk --out ./out
    python extract.py path/to/bundles_dir --out ./out --png

See datamine/README.md for how to obtain an APK and important caveats
(addressables downloaded at runtime, encrypted bundles, etc.).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path


def _require_unitypy():
    """Import UnityPy lazily so archive-walking helpers (and their tests) work
    without the heavy dependency installed."""
    try:
        import UnityPy
    except ImportError:  # pragma: no cover - dependency hint
        sys.exit(
            "UnityPy is required for extraction. Install the datamine deps:\n"
            "    pip install -r datamine/requirements.txt"
        )
    return UnityPy


# APK/XAPK are just zip files. These extensions inside them are worth scanning as
# Unity containers; everything else is copied out only if it looks like a bundle.
ARCHIVE_SUFFIXES = {".apk", ".xapk", ".apks", ".zip"}
# Unity data lives in files with no/opaque extensions, so we sniff content too.
UNITY_MAGIC = (b"UnityFS", b"UnityRaw", b"UnityWeb", b"\xfa\xfa\xfa\xfa")


def _looks_like_unity(data: bytes) -> bool:
    head = data[:32]
    if any(head.startswith(m) for m in UNITY_MAGIC):
        return True
    # Serialized files (level*, sharedassets*, resources.assets, CAB-*) begin
    # with a big-endian metadata-size header; sniff the common ".assets" markers.
    return b"CAB-" in head or head[4:8] == b"\x00\x00\x00\x00" and len(data) > 4096


def iter_unity_blobs(source: Path):
    """Yield (name, bytes) for every candidate Unity file under `source`.

    Handles a raw APK/zip (recursing into nested archives such as an XAPK that
    bundles multiple split APKs) and plain directories of extracted bundles.
    """
    if source.is_dir():
        for path in sorted(source.rglob("*")):
            if path.is_file():
                data = path.read_bytes()
                if _looks_like_unity(data) or path.suffix in ARCHIVE_SUFFIXES:
                    yield str(path.relative_to(source)), data
        return

    if source.suffix.lower() in ARCHIVE_SUFFIXES or zipfile.is_zipfile(source):
        yield from _iter_zip(source.name, source.read_bytes())
        return

    # A single loose bundle file.
    yield source.name, source.read_bytes()


def _iter_zip(label: str, blob: bytes):
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = f"{label}!{info.filename}"
            data = zf.read(info)
            suffix = Path(info.filename).suffix.lower()
            if suffix in ARCHIVE_SUFFIXES and zipfile.is_zipfile(io.BytesIO(data)):
                # Nested archive (XAPK -> base.apk -> ...). Recurse.
                yield from _iter_zip(name, data)
            elif _looks_like_unity(data):
                yield name, data


def _safe_name(*parts: str) -> str:
    raw = "__".join(p for p in parts if p)
    keep = "".join(c if c.isalnum() or c in "-_.!" else "_" for c in raw)
    return keep[:180] or "unnamed"


def export(source: Path, out: Path, want_png: bool, limit: int | None) -> dict:
    images = out / "images"
    texts = out / "text"
    monos = out / "mono"
    for d in (images, texts, monos):
        d.mkdir(parents=True, exist_ok=True)

    UnityPy = _require_unitypy()
    manifest = {"source": str(source), "objects": []}
    stats = {"bundles": 0, "textures": 0, "sprites": 0, "text": 0, "mono": 0, "errors": 0}

    for blob_name, data in iter_unity_blobs(source):
        try:
            env = UnityPy.load(data)
        except Exception as exc:  # noqa: BLE001 - keep going through a big APK
            stats["errors"] += 1
            manifest.setdefault("load_errors", []).append({"blob": blob_name, "error": str(exc)})
            continue

        objects = list(env.objects)
        if not objects:
            continue
        stats["bundles"] += 1

        for obj in objects:
            if limit and len(manifest["objects"]) >= limit:
                break
            try:
                record = _export_object(obj, blob_name, images, texts, monos, want_png, stats)
            except Exception as exc:  # noqa: BLE001
                stats["errors"] += 1
                continue
            if record:
                manifest["objects"].append(record)

    manifest["stats"] = stats
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return stats


def _export_object(obj, blob_name, images, texts, monos, want_png, stats):
    if obj.type.name in ("Texture2D", "Sprite"):
        parsed = obj.read()
        name = getattr(parsed, "m_Name", "") or getattr(parsed, "name", "")
        base = _safe_name(blob_name, name, str(obj.path_id))
        try:
            image = parsed.image  # UnityPy renders both Texture2D and Sprite
        except Exception:
            return None
        if image is None:
            return None
        image.save(images / f"{base}.webp", format="WEBP", quality=92, method=6)
        if want_png:
            image.save(images / f"{base}.png")
        stats["textures" if obj.type.name == "Texture2D" else "sprites"] += 1
        return {"kind": "image", "name": name, "blob": blob_name,
                "path_id": obj.path_id, "file": f"images/{base}.webp",
                "size": [image.width, image.height]}

    if obj.type.name == "TextAsset":
        parsed = obj.read()
        name = getattr(parsed, "m_Name", "") or "text"
        raw = getattr(parsed, "m_Script", None) or getattr(parsed, "script", b"")
        payload = raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else bytes(raw)
        ext = ".json" if payload[:1] in (b"{", b"[") else ".bytes"
        base = _safe_name(blob_name, name, str(obj.path_id))
        (texts / f"{base}{ext}").write_bytes(payload)
        stats["text"] += 1
        return {"kind": "text", "name": name, "blob": blob_name,
                "path_id": obj.path_id, "file": f"text/{base}{ext}", "bytes": len(payload)}

    if obj.type.name == "MonoBehaviour":
        # Prefer a full type-tree read; fall back to raw if no type tree is present.
        try:
            tree = obj.read_typetree()
        except Exception:
            return None
        name = tree.get("m_Name") or ""
        base = _safe_name(blob_name, name, str(obj.path_id))
        (monos / f"{base}.json").write_text(
            json.dumps(tree, indent=2, ensure_ascii=False, default=str)
        )
        stats["mono"] += 1
        return {"kind": "mono", "name": name, "blob": blob_name,
                "path_id": obj.path_id, "file": f"mono/{base}.json",
                "keys": sorted(tree.keys())[:40]}

    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="APK / XAPK / zip / bundle / directory")
    ap.add_argument("--out", type=Path, default=Path("out"), help="output directory (default: ./out)")
    ap.add_argument("--png", action="store_true", help="also write lossless PNGs next to the webp")
    ap.add_argument("--limit", type=int, default=None, help="stop after N exported objects (for quick probes)")
    args = ap.parse_args(argv)

    if not args.source.exists():
        sys.exit(f"No such source: {args.source}")

    print(f"Extracting {args.source} -> {args.out}")
    stats = export(args.source, args.out, args.png, args.limit)
    print("Done:")
    for key, value in stats.items():
        print(f"  {key:>9}: {value}")
    print(f"  manifest: {args.out / 'manifest.json'}")
    if stats["bundles"] == 0:
        print(
            "\nNo Unity bundles found. If this was the APK, the game likely "
            "downloads its assets at runtime (addressables on a CDN) — see "
            "datamine/README.md 'When the APK is nearly empty'."
        )


if __name__ == "__main__":
    main()
