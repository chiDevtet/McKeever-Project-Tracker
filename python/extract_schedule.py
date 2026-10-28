"""Text-based schedule PDF extraction for M&N FieldOps.

Reads a construction schedule PDF (Primavera-style "Activity ID / Activity
Name / duration / Start / Finish" layout with a Gantt area on the right) and
writes one JSON document to stdout. The TypeScript worker validates that JSON
before anything is stored. Nothing here modifies a plan.

Rules
- Columns are located per page from the header labels, not fixed positions.
- Start and Finish columns are kept separate from dates that appear inside
  activity names (those are reported as `embeddedDates` metadata only).
- "A" (actual) and "*" (constraint) markers are kept as source metadata.
- Overprinted (bold) rows are WBS summary rows; they build the hierarchy.
- Pages without extractable text are reported as issues (scanned PDFs need a
  spreadsheet or manual fallback; OCR is out of scope).

Usage: python3 -I extract_schedule.py <file.pdf>
"""

import json
import re
import sys

import pdfplumber

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_RE = re.compile(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})(\*?)$")
EMBEDDED_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]*$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")

HEADER_ALIASES = {
    "id": ["Activity ID", "Activity Id", "Task ID", "ID"],
    "name": ["Activity Name", "Task Name", "Description"],
    "od": ["OD", "Original Duration", "Orig Dur", "Duration", "Dur"],
    "rd": ["RD", "Remaining Duration", "Rem Dur"],
    "start": ["Start", "Early Start", "Start Date"],
    "finish": ["Finish", "Early Finish", "Finish Date"],
}


def parse_date(token):
    m = DATE_RE.match(token)
    if not m:
        return None
    day, mon, year, star = m.groups()
    month = MONTHS.get(mon.lower())
    if not month:
        return None
    y = int(year)
    if y < 100:
        y += 2000
    try:
        import datetime

        datetime.date(y, month, int(day))
    except ValueError:
        return None
    return {"date": f"{y:04d}-{month:02d}-{int(day):02d}", "constraint": star == "*"}


def cluster_lines(words, tol=2.5):
    lines = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        if lines and abs(lines[-1]["top"] - w["top"]) <= tol:
            lines[-1]["words"].append(w)
        else:
            lines.append({"top": w["top"], "bottom": w["bottom"], "words": [w]})
    for ln in lines:
        ln["words"].sort(key=lambda w: w["x0"])
        ln["bottom"] = max(w["bottom"] for w in ln["words"])
    return lines


def find_header(lines):
    """Return column anchors from the first line containing the header labels."""
    for ln in lines[:12]:
        text = " ".join(w["text"] for w in ln["words"])
        if "Start" in text and "Finish" in text and ("Activity" in text or "Task" in text):
            ws = ln["words"]
            anchors = {}
            # Two-word labels first, then single words.
            for key, labels in HEADER_ALIASES.items():
                for label in labels:
                    parts = label.split()
                    for i in range(len(ws) - len(parts) + 1):
                        if [w["text"] for w in ws[i : i + len(parts)]] == parts:
                            cand = {"x0": ws[i]["x0"], "x1": ws[i + len(parts) - 1]["x1"]}
                            # "Activity" appears in both ID and Name labels; keep first for id, second for name.
                            if key in anchors:
                                continue
                            if key == "name" and "id" in anchors and cand["x0"] <= anchors["id"]["x0"]:
                                continue
                            anchors[key] = cand
                            break
                    if key in anchors:
                        break
            years = [w for w in ws if re.fullmatch(r"(19|20)\d\d", w["text"])]
            gantt_x0 = min((w["x0"] for w in years), default=None)
            if "start" in anchors and "finish" in anchors and "name" in anchors:
                return ln, anchors, gantt_x0
    return None, None, None


def column_bounds(anchors, gantt_x0, page_width):
    center = {k: (v["x0"] + v["x1"]) / 2 for k, v in anchors.items()}
    order = [k for k in ["od", "rd", "start", "finish"] if k in center]
    bounds = {}
    name_left = anchors["name"]["x0"] - 3
    bounds["id"] = (0, name_left)
    first_num = center[order[0]]
    # Name column ends shortly before the first numeric/date column.
    gap = (center[order[1]] - center[order[0]]) / 2 if len(order) > 1 else 20
    bounds["name"] = (name_left, first_num - min(gap, 22))
    right_end = (gantt_x0 - 6) if gantt_x0 else page_width
    for i, k in enumerate(order):
        left = (center[order[i - 1]] + center[k]) / 2 if i > 0 else bounds["name"][1]
        right = (center[k] + center[order[i + 1]]) / 2 if i + 1 < len(order) else right_end
        bounds[k] = (left, right)
    return bounds


def column_of(word, bounds):
    cx = (word["x0"] + word["x1"]) / 2
    for k in ["id", "name", "od", "rd", "start", "finish"]:
        if k in bounds and bounds[k][0] <= cx < bounds[k][1]:
            return k
    return None


def parse_date_cell(tokens):
    """Tokens in a Start/Finish cell, e.g. ["28-Apr-26", "A"] or ["16-Aug-27*"]."""
    if not tokens:
        return None
    raw = " ".join(tokens)
    parsed = parse_date(tokens[0])
    if not parsed:
        return {"raw": raw, "date": None, "actual": False, "constraint": False}
    actual = any(t == "A" for t in tokens[1:])
    constraint = parsed["constraint"] or any(t == "*" for t in tokens[1:])
    return {"raw": raw, "date": parsed["date"], "actual": actual, "constraint": constraint}


def embedded_dates(name):
    out = []
    for m, d, y in EMBEDDED_DATE_RE.findall(name):
        try:
            out.append(f"{int(y):04d}-{int(m):02d}-{int(d):02d}")
        except ValueError:
            pass
    return out


def dedupe_exact(chars):
    """Drop overprinted duplicates (same glyph at the same position); return kept chars and per-line duplicate ratios."""
    kept = []
    seen = set()
    per_line = {}
    for c in chars:
        key = (c["text"], round(c["x0"], 2), round(c["top"], 2), c.get("fontname"), round(c.get("size", 0), 1))
        line = round(c["top"])
        tot, dup = per_line.get(line, (0, 0))
        if key in seen:
            per_line[line] = (tot + 1, dup + 1)
            continue
        seen.add(key)
        per_line[line] = (tot + 1, dup)
        kept.append(c)
    ratios = {line: dup / tot for line, (tot, dup) in per_line.items() if tot}
    return kept, ratios


def page_record(args):
    """Parse one page into structured lines (runs in a worker process)."""
    path, pno = args
    from pdfplumber.utils import extract_words

    with pdfplumber.open(path, pages=[pno]) as pdf:
        page = pdf.pages[0]
        rec = {"number": pno, "width": float(page.width), "height": float(page.height), "chars": 0, "headerFound": False, "lines": [], "meta": {}}
        chars = page.chars
        rec["chars"] = len(chars)
        if not chars:
            return rec
        kept, dup_ratio = dedupe_exact(chars)
        words = extract_words(kept, x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False, use_text_flow=False)
        lines = cluster_lines(words)
        header, anchors, gantt_x0 = find_header(lines)
        if pno == 1 and header:
            rec["meta"]["title"] = " / ".join(" ".join(w["text"] for w in ln["words"]) for ln in lines if ln["top"] < header["top"])[:300]
        footer_top = rec["height"]
        for ln in lines:
            text = " ".join(w["text"] for w in ln["words"])
            if re.search(r"Page \d+ of \d+", text) or "Run Date" in text or "Data Date" in text:
                footer_top = min(footer_top, ln["top"] - 1)
                m = re.search(r"Run Date:\s*([0-9]{2}-[A-Za-z]{3}-[0-9]{2}(?:\s+[0-9:]+)?)", text)
                if m:
                    rec["meta"]["runDate"] = m.group(1)
                m = re.search(r"Data Date:\s*([0-9]{2}-[A-Za-z]{3}-[0-9]{2})", text)
                if m:
                    d = parse_date(m.group(1))
                    rec["meta"]["dataDate"] = d["date"] if d else m.group(1)
        if not header:
            return rec
        rec["headerFound"] = True
        bounds = column_bounds(anchors, gantt_x0, rec["width"])
        rec["columns"] = {k: [round(a, 1), round(b, 1)] for k, (a, b) in bounds.items()}
        id_x0 = anchors["id"]["x0"] if "id" in anchors else 0
        body_top = header["bottom"] + 1
        for ln in lines:
            if ln["top"] < body_top:
                continue
            if re.fullmatch(r"(Q[1-4]\s*)+", " ".join(w["text"] for w in ln["words"]).strip()):
                body_top = ln["bottom"] + 1
            break
        for ln in lines:
            if ln["top"] < body_top or ln["top"] >= footer_top:
                continue
            cells = {"id": [], "name": [], "od": [], "rd": [], "start": [], "finish": []}
            for w in ln["words"]:
                k = column_of(w, bounds)
                if k:
                    cells[k].append(w["text"])
            if not any(cells.values()):
                continue
            first_x = min(w["x0"] for w in ln["words"] if column_of(w, bounds) in ("id", "name"))  if any(column_of(w, bounds) in ("id", "name") for w in ln["words"]) else None
            bold = max(dup_ratio.get(round(ln["top"]) + d, 0) for d in (-1, 0, 1)) >= 0.4
            rec["lines"].append({"top": round(ln["top"], 1), "bold": bold, "level": None if first_x is None else max(0, int(round((first_x - id_x0) / 8.0))), "cells": cells, "text": " ".join(w["text"] for w in ln["words"])[:300]})
        return rec


def extract(path, processes):
    out = {"schema": 1, "pageCount": 0, "meta": {}, "pages": [], "rows": [], "issues": []}
    with pdfplumber.open(path) as pdf:
        out["pageCount"] = len(pdf.pages)
    jobs = [(path, n) for n in range(1, out["pageCount"] + 1)]
    if processes > 1 and len(jobs) > 1:
        import multiprocessing

        with multiprocessing.get_context("fork").Pool(processes) as pool:
            records = []
            for i, rec in enumerate(pool.imap(page_record, jobs)):
                records.append(rec)
                print(f"PROGRESS {i + 1}/{len(jobs)}", file=sys.stderr, flush=True)
    else:
        records = []
        for i, j in enumerate(jobs):
            records.append(page_record(j))
            print(f"PROGRESS {i + 1}/{len(jobs)}", file=sys.stderr, flush=True)

    wbs_stack = []  # (level, name)
    for rec in records:
        pno = rec["number"]
        out["meta"].update(rec["meta"])
        info = {k: rec[k] for k in ("number", "width", "height", "chars", "headerFound")}
        info["rows"] = 0
        if "columns" in rec:
            info["columns"] = rec["columns"]
        out["pages"].append(info)
        if not rec["chars"]:
            out["issues"].append({"page": pno, "kind": "no-text", "message": f"Page {pno} has no extractable text (scanned image?). Use a spreadsheet export or enter rows manually."})
            continue
        if not rec["headerFound"]:
            out["issues"].append({"page": pno, "kind": "no-header", "message": f"Page {pno}: column headings (Activity ID, Activity Name, Start, Finish) were not found; the page was skipped."})
            continue
        last_row = None
        for ln in rec["lines"]:
            cells = ln["cells"]
            id_text = " ".join(cells["id"])
            name_text = " ".join(cells["name"])
            has_values = bool(cells["od"] or cells["rd"] or cells["start"] or cells["finish"])
            start = parse_date_cell(cells["start"])
            finish = parse_date_cell(cells["finish"])
            od = " ".join(cells["od"]) or None
            rd = " ".join(cells["rd"]) or None
            level = ln["level"] or 0
            single_id = len(cells["id"]) == 1 and ID_RE.match(id_text) is not None
            # WBS summary rows carry their label in the ID column (spilling into the name column)
            # instead of a single activity ID token; a lone token with no name is a top-level WBS code.
            is_wbs = bool(id_text) and (not single_id or not name_text)
            if is_wbs:
                label = (id_text + " " + name_text).strip()
                while wbs_stack and wbs_stack[-1][0] >= level:
                    wbs_stack.pop()
                wbs_stack.append((level, label))
                out["rows"].append({"page": pno, "kind": "WBS", "level": level, "externalId": None, "name": label, "od": od, "rd": rd, "start": start, "finish": finish, "wbsPath": [n for _, n in wbs_stack[:-1]], "embeddedDates": embedded_dates(label), "top": ln["top"], "emphasized": False})
                last_row = None
                info["rows"] += 1
                continue
            if not id_text and not has_values and name_text and last_row is not None:
                last_row["name"] = (last_row["name"] + " " + name_text).strip()
                last_row["embeddedDates"] = embedded_dates(last_row["name"])
                continue
            if not single_id:
                if id_text or has_values or name_text:
                    out["issues"].append({"page": pno, "kind": "unparsed-line", "message": f"Page {pno}: a line without a recognizable activity ID was not imported: {(id_text + ' ' + name_text).strip()[:120]}", "text": ln["text"]})
                continue
            is_milestone = (od is not None and NUM_RE.match(od) is not None and float(od) == 0) or name_text.lower().startswith("milestone")
            row = {"page": pno, "kind": "MILESTONE" if is_milestone else "ACTIVITY", "level": level, "externalId": id_text, "name": name_text, "od": od, "rd": rd, "start": start, "finish": finish, "wbsPath": [n for _, n in wbs_stack], "embeddedDates": embedded_dates(name_text), "top": ln["top"], "emphasized": ln["bold"]}
            for k, cell in (("start", start), ("finish", finish)):
                if cell and cell["date"] is None:
                    out["issues"].append({"page": pno, "kind": "bad-date", "externalId": id_text, "message": f"Page {pno} {id_text}: {k} value {cell['raw']!r} is not a recognized date"})
            out["rows"].append(row)
            last_row = row
            info["rows"] += 1
    if not [r for r in out["rows"] if r["kind"] != "WBS"]:
        out["issues"].append({"page": None, "kind": "empty", "message": "No schedule rows were extracted. The PDF may be scanned or use an unsupported layout. Import a CSV or Excel export instead, or enter activities manually."})
    return out


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: extract_schedule.py <file.pdf>"}))
        return 2
    import os

    processes = int(os.environ.get("FIELDOPS_PDF_PROCESSES", str(min(4, os.cpu_count() or 1))))
    try:
        result = extract(sys.argv[1], processes)
    except Exception as exc:  # noqa: BLE001 - reported to the worker as a structured failure
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
