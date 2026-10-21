#!/usr/bin/env python3
"""Build index.html (full document for any static host) from page.html.

page.html holds the page content without <!doctype>/<html>/<head>/<body>, which is the
format claude.ai Artifacts expect. index.html wraps the same content in a standard document.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
page = (root / "page.html").read_text(encoding="utf-8")
cut = page.index('<div class="wrap">')
head_part, body_part = page[:cut], page[cut:]
doc = (
    "<!doctype html>\n<html lang=\"en\">\n<head>\n"
    "<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
    "<meta name=\"theme-color\" content=\"#17213a\">\n"
    "<style>[hidden]{display:none!important}</style>\n"
    + head_part.strip() + "\n</head>\n<body>\n" + body_part + "</body>\n</html>\n"
)
(root / "index.html").write_text(doc, encoding="utf-8")
print("wrote index.html")
