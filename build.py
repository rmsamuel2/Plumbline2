#!/usr/bin/env python3
"""Build script for Plumbline 6 (layered architecture).

Stitches the decomposed, layered sources under ``src/`` into the single, offline
application file ``dist/Plumbline_Studio_V2.html``. No third-party dependencies —
any Python 3.6+ works.

    python3 build.py            # build dist/Plumbline_Studio_V2.html
    python3 build.py --check    # build, then verify structure + print size/SHA-256

Layering (see docs/): the template ``presentation/shell.html`` contains ordered
markers that are filled with each layer's code. The order is LOAD-BEARING because
each facade must exist as a global before the next layer (and the UI) runs:

    @@STUDIO_CSS@@         <- presentation/studio.css     (inlined <style>)
    @@RUNTIME_JS@@         <- engine/runtime.js           shared module registry (window.__PL)
    @@ENGINE_MODULES_JS@@  <- engine/modules.gen.js       encapsulated math modules
    @@ENGINE_FACADE_JS@@   <- engine/facade.js            window.PlumblineEngine
    @@MONOID_JS@@          <- engine/monoid.js            window.PlumblineMonoid
    @@DATA_GATEWAY_JS@@    <- data/data-gateway.js        window.PlumblineData
    @@LLM_GATEWAY_JS@@     <- llm/llm-gateway.js          window.PlumblineLLM
    @@UI_MODULES_JS@@      <- app/ui-modules.gen.js        presentation modules
    @@UI_BOOT_JS@@         <- app/ui-boot.js               starts the Studio
    @@EDITOR_HTML_B64@@    <- editor/workflow-editor.html  base64, decoded at runtime
    @@LOADER_JS@@          <- app/loader.js                page router + iframe loader

The math (engine/) is physically separate from the presentation (app/,
presentation/, editor/) — the HTML front-end carries NO math, only calls to the
PlumblineEngine / PlumblineMonoid / PlumblineData / PlumblineLLM facades.

The embedded Workflow Editor (editor/workflow-editor.html) is the screen updated
by the 2026-07 change set: Preset "Load" button, Finance "Cost / Time Analysis"
button, the Cloud SQL box and the File box were removed; Login / Sign up buttons,
box copy/paste (mouse + Ctrl+C/Ctrl+V), and box-to-box dependencies were added;
the Edit Process fields grow to fit their content and the canvas uses more of the
screen. None of that changes the build contract below — the editor is still
embedded verbatim as base64.
"""

import base64
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
OUT_NAME = "Plumbline_Studio_V2.html"

# marker -> (relative source path under src/, mode)   mode: "text" inline as-is, "b64" base64
PARTS = [
    ("@@STUDIO_CSS@@",        "presentation/studio.css",     "text"),
    ("@@RUNTIME_JS@@",        "engine/runtime.js",           "text"),
    ("@@ENGINE_MODULES_JS@@", "engine/modules.gen.js",       "text"),
    ("@@ENGINE_FACADE_JS@@",  "engine/facade.js",            "text"),
    ("@@MONOID_JS@@",         "engine/monoid.js",            "text"),
    ("@@DATA_GATEWAY_JS@@",   "data/data-gateway.js",        "text"),
    ("@@LLM_GATEWAY_JS@@",    "llm/llm-gateway.js",          "text"),
    ("@@UI_MODULES_JS@@",     "app/ui-modules.gen.js",       "text"),
    # Phase 1: the presentation layer is three routed screen modules over a
    # shared core. Order is load-bearing only in that every module must be
    # defined before ui-boot.js loads the router; __PL resolves lazily, so the
    # modules themselves may be listed in any order.
    ("@@SHARED_DOM_JS@@",       "app/modules/shared/dom.ts",        "text"),
    ("@@SHARED_WORKSPACE_JS@@", "app/modules/shared/workspace.ts",  "text"),
    ("@@SHARED_AUTH_JS@@",      "app/modules/shared/auth.ts",       "text"),
    ("@@SHARED_LIBRARY_JS@@",   "app/modules/shared/library.ts",    "text"),
    ("@@MODULE_EDITOR_JS@@",    "app/modules/editor/editor.ts",     "text"),
    ("@@MODULE_ANALYSIS_JS@@",  "app/modules/analysis/analysis.ts", "text"),
    ("@@MODULE_HOME_JS@@",      "app/modules/home/home.ts",         "text"),
    ("@@MODULE_MAINTENANCE_JS@@", "app/modules/maintenance/maintenance.ts", "text"),
    ("@@ROUTER_JS@@",           "app/router.js",                    "text"),
    ("@@UI_BOOT_JS@@",        "app/ui-boot.js",              "text"),
    ("@@EDITOR_HTML_B64@@",   "editor/workflow-editor.html", "b64"),
    ("@@LOADER_JS@@",         "app/loader.js",               "text"),
]

# facade globals that must survive into the built file (structural self-check)
REQUIRED_MODULES = (
    "studio/shared/dom.ts",
    "studio/shared/workspace.ts",
    "studio/shared/auth.ts",
    "studio/shared/library.ts",
    "studio/modules/editor.ts",
    "studio/modules/analysis.ts",
    "studio/modules/home.ts",
    "studio/modules/maintenance.ts",
    "studio/router.ts",
)

REQUIRED_GLOBALS = (
    "window.PlumblineEngine",
    "window.PlumblineMonoid",
    "window.PlumblineData",
    "window.PlumblineLLM",
    "window.__PL",
)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def read_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def build():
    shell_path = os.path.join(SRC, "presentation", "shell.html")
    shell = read_text(shell_path)

    # Every marker must appear exactly once before we start replacing.
    for marker, rel, _mode in PARTS:
        count = shell.count(marker)
        if count != 1:
            sys.exit("error: marker %s must appear exactly once in shell.html (found %d)" % (marker, count))
        src_path = os.path.join(SRC, rel)
        if not os.path.isfile(src_path):
            sys.exit("error: missing source for %s: %s" % (marker, src_path))

    html = shell
    for marker, rel, mode in PARTS:
        path = os.path.join(SRC, rel)
        payload = read_b64(path) if mode == "b64" else read_text(path)
        # Plain str.replace so any $ / backslashes in the code are treated literally.
        html = html.replace(marker, payload)

    os.makedirs(DIST, exist_ok=True)
    out_path = os.path.join(DIST, OUT_NAME)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    return out_path, html


def check(html):
    for marker, _rel, _mode in PARTS:
        if marker in html:
            sys.exit("error: unfilled marker survived into output: %s" % marker)
    for needle in REQUIRED_GLOBALS:
        if needle not in html:
            sys.exit("error: expected global missing from build: %s" % needle)
    for mod in REQUIRED_MODULES:
        if ('__PL.define("%s"' % mod) not in html:
            sys.exit("error: expected module missing from build: %s" % mod)
    if '__PL.define("studio/main.ts"' in html:
        sys.exit("error: studio/main.ts is still present — it was split into "
                 "app/modules/ in Phase 1 and must not be rebuilt into the bundle")
    print("  check: OK — all layers inlined, facades present, "
          "%d presentation modules registered, no stray markers" % len(REQUIRED_MODULES))


def main():
    do_check = "--check" in sys.argv[1:]
    out_path, html = build()
    data = html.encode("utf-8")
    print("built %s" % out_path)
    print("  size: {:,} bytes".format(len(data)))
    print("  sha256: %s" % hashlib.sha256(data).hexdigest())
    if do_check:
        check(html)


if __name__ == "__main__":
    main()
