from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.conversion import convert_path_to_markdown


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run smoke tests against sample files."
    )
    parser.add_argument(
        "sample_dir",
        nargs="?",
        default=r"D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件",
        help="Directory containing sample files",
    )
    parser.add_argument(
        "--include-images",
        action="store_true",
        help="Inline local images when possible",
    )
    args = parser.parse_args()

    sample_dir = Path(args.sample_dir)
    failures: list[str] = []

    for path in sorted(sample_dir.iterdir()):
        if not path.is_file():
            continue
        try:
            markdown = convert_path_to_markdown(
                str(path), args.include_images, path.name
            )
            if not markdown.strip():
                raise RuntimeError("Empty markdown output")
            print(f"OK  {path.name} -> {len(markdown)} chars")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{path.name}: {exc}")
            print(f"FAIL {path.name}: {exc}")

    if failures:
        print("\nFailures:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
