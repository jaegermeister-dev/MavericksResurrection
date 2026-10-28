#!/usr/bin/env python3
"""Retarget Mach-O nlist entries without changing executable size or code."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
from pathlib import Path


MH_MAGIC_64 = 0xFEEDFACF
LC_SYMTAB = 0x2
LC_DYSYMTAB = 0xB
N_STAB = 0xE0
N_TYPE = 0x0E
N_UNDF = 0x00
N_SECT = 0x0E
N_EXT = 0x01


def io_path(path: Path) -> Path:
    raw = str(path.resolve())
    if os.name == "nt" and not raw.startswith("\\\\?\\"):
        return Path("\\\\?\\" + raw)
    return path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cstring(data: bytes, offset: int, limit: int) -> bytes:
    if not 0 <= offset < limit:
        raise ValueError(f"string offset {offset} outside string table")
    end = data.find(b"\0", offset, limit)
    if end < 0:
        raise ValueError(f"unterminated string at offset {offset}")
    return data[offset:end]


def parse_macho(data: bytes) -> dict[str, object]:
    if len(data) < 32:
        raise ValueError("file is too small for a Mach-O 64 header")
    magic, = struct.unpack_from("<I", data, 0)
    if magic != MH_MAGIC_64:
        raise ValueError(f"expected little-endian MH_MAGIC_64, got 0x{magic:08x}")
    ncmds, = struct.unpack_from("<I", data, 16)
    offset = 32
    symtab = None
    dysymtab = None
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from("<II", data, offset)
        if cmdsize < 8 or offset + cmdsize > len(data):
            raise ValueError("invalid Mach-O load command")
        if cmd == LC_SYMTAB:
            _, _, symoff, nsyms, stroff, strsize = struct.unpack_from("<IIIIII", data, offset)
            symtab = (symoff, nsyms, stroff, strsize)
        elif cmd == LC_DYSYMTAB:
            fields = struct.unpack_from("<IIIIIIII", data, offset)
            dysymtab = {
                "ilocalsym": fields[2],
                "nlocalsym": fields[3],
                "iextdefsym": fields[4],
                "nextdefsym": fields[5],
                "iundefsym": fields[6],
                "nundefsym": fields[7],
            }
        offset += cmdsize
    if symtab is None or dysymtab is None:
        raise ValueError("Mach-O requires both LC_SYMTAB and LC_DYSYMTAB")
    symoff, nsyms, stroff, strsize = symtab
    if symoff + nsyms * 16 > len(data) or stroff + strsize > len(data):
        raise ValueError("symbol or string table extends beyond file")
    symbols = []
    for index in range(nsyms):
        entry_offset = symoff + index * 16
        n_strx, n_type, n_sect, n_desc, n_value = struct.unpack_from("<IBBHQ", data, entry_offset)
        name = cstring(data, stroff + n_strx, stroff + strsize) if n_strx else b""
        symbols.append({
            "index": index,
            "entry_offset": entry_offset,
            "n_strx": n_strx,
            "n_type": n_type,
            "n_sect": n_sect,
            "n_desc": n_desc,
            "n_value": n_value,
            "name": name,
        })
    return {
        "symoff": symoff,
        "nsyms": nsyms,
        "stroff": stroff,
        "strsize": strsize,
        "symbols": symbols,
        **dysymtab,
    }


def find_unique(symbols: list[dict[str, object]], name: bytes) -> dict[str, object]:
    matches = [symbol for symbol in symbols if symbol["name"] == name]
    if len(matches) != 1:
        raise ValueError(f"expected one symbol named {name!r}, found {len(matches)}")
    return matches[0]


def retarget_existing(data: bytearray, parsed: dict[str, object], old: bytes, new: bytes) -> dict[str, object]:
    symbols = parsed["symbols"]
    source = find_unique(symbols, old)
    target = find_unique(symbols, new)
    if (source["n_type"] & N_TYPE) != N_UNDF or not (source["n_type"] & N_EXT):
        raise ValueError("source symbol is not external undefined")
    struct.pack_into("<I", data, source["entry_offset"], target["n_strx"])
    return {
        "mode": "retarget-to-existing-string",
        "source_symbol": old.decode("ascii"),
        "target_symbol": new.decode("ascii"),
        "source_symbol_index": source["index"],
        "target_symbol_index": target["index"],
        "source_nlist_offset": source["entry_offset"],
        "old_n_strx": source["n_strx"],
        "new_n_strx": target["n_strx"],
    }


def retarget_with_local_string_slot(
    data: bytearray,
    parsed: dict[str, object],
    old: bytes,
    new: bytes,
) -> dict[str, object]:
    symbols = parsed["symbols"]
    source = find_unique(symbols, old)
    if (source["n_type"] & N_TYPE) != N_UNDF or not (source["n_type"] & N_EXT):
        raise ValueError("source symbol is not external undefined")
    if any(symbol["name"] == new for symbol in symbols):
        raise ValueError("target already exists; use direct retarget mode")
    local_start = parsed["ilocalsym"]
    local_end = local_start + parsed["nlocalsym"]
    str_offsets = [symbol["n_strx"] for symbol in symbols if symbol["n_strx"]]
    candidates = []
    for symbol in symbols[local_start:local_end]:
        name = symbol["name"]
        if not name or len(name) < len(new):
            continue
        if symbol["n_type"] & N_STAB:
            continue
        if (symbol["n_type"] & N_TYPE) != N_SECT or symbol["n_type"] & N_EXT:
            continue
        slot_start = symbol["n_strx"]
        slot_end = slot_start + len(name) + 1
        if sum(1 for value in str_offsets if slot_start <= value < slot_end) != 1:
            continue
        candidates.append(symbol)
    if not candidates:
        raise ValueError("no safe, unshared local string-table slot is large enough")
    donor = min(candidates, key=lambda symbol: (len(symbol["name"]), symbol["index"]))
    donor_slot = donor["n_strx"]
    donor_name = donor["name"]
    stroff = parsed["stroff"]
    slot_offset = stroff + donor_slot
    slot_size = len(donor_name) + 1
    replacement = new + b"\0" + b"\0" * (slot_size - len(new) - 1)
    data[slot_offset:slot_offset + slot_size] = replacement
    struct.pack_into("<I", data, donor["entry_offset"], 0)
    struct.pack_into("<I", data, source["entry_offset"], donor_slot)
    return {
        "mode": "retarget-to-reclaimed-local-string-slot",
        "source_symbol": old.decode("ascii"),
        "target_symbol": new.decode("ascii"),
        "source_symbol_index": source["index"],
        "source_nlist_offset": source["entry_offset"],
        "old_source_n_strx": source["n_strx"],
        "new_source_n_strx": donor_slot,
        "donor_symbol_index": donor["index"],
        "donor_nlist_offset": donor["entry_offset"],
        "donor_original_name": donor_name.decode("ascii", errors="replace"),
        "donor_original_length": len(donor_name),
        "reclaimed_string_file_offset": slot_offset,
        "reclaimed_string_slot_size": slot_size,
    }


def patch_one(path: Path, mappings: list[tuple[bytes, bytes, str]], apply: bool) -> dict[str, object]:
    physical = io_path(path)
    before = physical.read_bytes()
    data = bytearray(before)
    operations = []
    for old, new, mode in mappings:
        parsed = parse_macho(bytes(data))
        if mode == "existing":
            operations.append(retarget_existing(data, parsed, old, new))
        elif mode == "reclaim":
            operations.append(retarget_with_local_string_slot(data, parsed, old, new))
        else:
            raise ValueError(f"unknown mapping mode {mode}")
    after = bytes(data)
    if len(after) != len(before):
        raise AssertionError("symbol retarget changed file size")
    changed = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
    if apply:
        physical.write_bytes(after)
    return {
        "path": str(path),
        "applied": apply,
        "file_size": len(before),
        "sha256_before": sha256(before),
        "sha256_after": sha256(after),
        "changed_byte_count": len(changed),
        "changed_first_offset": min(changed) if changed else None,
        "changed_last_offset": max(changed) if changed else None,
        "operations": operations,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--retarget-existing", action="append", default=[], nargs=2, metavar=("OLD", "NEW"))
    parser.add_argument("--retarget-reclaim", action="append", default=[], nargs=2, metavar=("OLD", "NEW"))
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    mappings = [
        *((old.encode("ascii"), new.encode("ascii"), "existing") for old, new in args.retarget_existing),
        *((old.encode("ascii"), new.encode("ascii"), "reclaim") for old, new in args.retarget_reclaim),
    ]
    if not mappings:
        raise ValueError("at least one retarget mapping is required")
    results = [patch_one(path, mappings, args.apply) for path in args.paths]
    report = {
        "format": "MavericksProgress Mach-O nlist retarget report v1",
        "results": results,
    }
    io_path(args.report).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
