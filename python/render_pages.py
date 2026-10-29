"""Render PDF pages to PNG previews for import review.

Writes page-<n>.png files into the output directory and one JSON line to
stdout ({"pages": n}). Rendering uses pdfium (installed with pdfplumber) and
never executes document scripts or follows links.

Usage: python3 -I render_pages.py <file.pdf> <out-dir> [scale]
"""

import json
import os
import sys

import pypdfium2 as pdfium


def main():
    if len(sys.argv) not in (3, 4):
        print(json.dumps({"error": "usage: render_pages.py <file.pdf> <out-dir> [scale]"}))
        return 2
    src, out_dir = sys.argv[1], sys.argv[2]
    scale = float(sys.argv[3]) if len(sys.argv) == 4 else 1.25
    try:
        pdf = pdfium.PdfDocument(src)
        total = len(pdf)
        for i in range(total):
            page = pdf[i]
            image = page.render(scale=scale).to_pil().convert("L")
            image.save(os.path.join(out_dir, f"page-{i + 1}.png"), compress_level=6)
            page.close()
            print(f"PROGRESS {i + 1}/{total}", file=sys.stderr, flush=True)
        pdf.close()
    except Exception as exc:  # noqa: BLE001 - reported to the worker as a structured failure
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps({"pages": total, "scale": scale}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
