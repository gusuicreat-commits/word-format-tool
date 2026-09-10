"""Render local audit outputs with explicitly selected native QA dependencies."""

import argparse
import os
from pathlib import Path
import runpy
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("documents", nargs="+", type=Path)
    parser.add_argument("--renderer", required=True, type=Path)
    parser.add_argument("--soffice-dir", required=True, type=Path)
    parser.add_argument("--poppler-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    for folder, executable in ((args.soffice_dir, "soffice.exe"), (args.poppler_dir, "pdftoppm.exe")):
        if not (folder / executable).is_file():
            parser.error(f"Missing {folder / executable}")
    # Runtime launchers can replace PATH; set it inside the launched process.
    os.environ["PATH"] = os.pathsep.join((str(args.soffice_dir.resolve()), str(args.poppler_dir.resolve()), os.environ.get("PATH", "")))
    for document in args.documents:
        sys.argv = [str(args.renderer), str(document.resolve()), "--output_dir",
                    str((args.output_dir / document.stem).resolve()), "--emit_pdf"]
        runpy.run_path(str(args.renderer), run_name="__main__")


if __name__ == "__main__":
    main()
