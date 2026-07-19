# Contributing to Plumbline

## Workflow

1. Clone the repo: `git clone https://github.com/rmsamuel2/plumbline.git`
2. Create a branch for your change: `git checkout -b feature/short-description`
3. Make your changes and commit.
4. Push your branch: `git push origin feature/short-description`
5. Open a Pull Request into `master`. At least one review/approval is required before merging.

## Local setup

- **Front-end**: open `src/plumbline-dev.html` directly, or serve `src/` with `python -m http.server` for the full editor↔studio experience.
- **Server**: see `server/README.md`. Copy `server/.env.example` to `server/.env` and fill in your own `DATABASE_URL`, `SESSION_SECRET`, and `ANTHROPIC_API_KEY` — never commit `.env`.
- **Build the single-file app**: `python build.py` (or `build.cmd` / `build.ps1` on Windows) → outputs `dist/Plumbline_Studio_V2.html`.

## Guidelines

- Keep the layer boundaries intact (see `README.md` — presentation / engine / data / llm / server). Presentation should never contain math; the engine facade is the only sanctioned math entry point.
- Don't commit secrets, `.env` files, or `node_modules/`.
- Run `python build.py --check` before opening a PR that touches `src/` to confirm the build still produces a valid output.
