#!/usr/bin/env python3
"""Append Markdown content from one or more chunk files (or stdin).

When content is too large to pass through the shell in a single operation,
split it across multiple temp files and pass each with --input-file.
The files are concatenated in the order given before appending.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Append markdown file with UTF-8 using one or more input files or stdin. "
            "Multiple --input-file flags are concatenated in order (chunked append)."
        )
    )
    parser.add_argument("target", help="Target markdown file path (.md)")

    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--input-file",
        dest="input_files",
        action="append",
        metavar="FILE",
        help=(
            "Read markdown content from FILE. "
            "Repeat to concatenate multiple chunk files in order."
        ),
    )
    source_group.add_argument(
        "--stdin",
        action="store_true",
        help="Read markdown content from standard input",
    )

    return parser.parse_args()


def validate_target(target: Path) -> None:
    if target.suffix.lower() != ".md":
        raise ValueError("Target file must end with .md")


def read_content(args: argparse.Namespace) -> str:
    if args.input_files:
        parts: list[str] = []
        for path_str in args.input_files:
            chunk_path = Path(path_str)
            if not chunk_path.exists():
                raise FileNotFoundError(f"Input file not found: {chunk_path}")
            parts.append(chunk_path.read_text(encoding="utf-8"))
        return "".join(parts)
    return sys.stdin.read()


def main() -> int:
    args = parse_args()
    target = Path(args.target)

    validate_target(target)
    content = read_content(args)

    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as file:
        file.write(content)

    chunk_count = len(args.input_files) if args.input_files else 1
    label = f"{chunk_count} chunk(s)" if chunk_count > 1 else "content"
    print(f"Appended {target} ({label})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)