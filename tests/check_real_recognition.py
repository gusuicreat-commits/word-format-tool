"""Check manually selected semantic expectations against saved audit reports."""
import argparse
import hashlib
import json
from pathlib import Path


def check(directory):
    expectations = json.loads(Path(__file__).with_name("real_recognition_expectations.json").read_text(encoding="utf-8"))
    results = []
    for filename, labels in expectations.items():
        source = directory / filename
        for template in ("default", "course_paper"):
            report = json.loads(source.with_name(f"{source.stem}-{template}-output.json").read_text(encoding="utf-8"))
            paragraphs = {str(p["index"]): p for p in report["paragraphs"]}
            for index, expected in labels.items():
                actual = paragraphs.get(index, {}).get("detected_type")
                results.append({"file": filename, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                                "template": template, "index": int(index), "expected": expected,
                                "actual": actual, "passed": actual == expected})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    results = check(args.directory)
    (args.directory / "recognition-checks.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    failed = [r for r in results if not r["passed"]]
    print(json.dumps({"checks": len(results), "failed": failed}))
    raise SystemExit(bool(failed))
