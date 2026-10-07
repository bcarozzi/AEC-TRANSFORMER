# AEC-TRANSFORMER

ALLIS ELECTRIC TRANSFORMERS

## Transformer Designer

Power transformer specification in → single-line diagram, vector-group diagram,
performance curves and bill of materials out. Node.js, no build step.

This is **phase 1** of a staged build (see [Roadmap](#roadmap)). It works from data
tables and a web form. Reading DWG/PDF/image drawings and the 3D model come in later phases.

### Quick start

```bash
npm install
npm start            # http://127.0.0.1:3100
npm test
```

`PORT` and `HOST` are environment variables. The server binds to `127.0.0.1`
by default; set `HOST=0.0.0.0` deliberately to expose it. There is no
authentication.

### Security notes

- No authentication; localhost-only by default.
- Uploads are capped at 10 MB and 2,000 rows, and only `.csv`, `.tsv`, `.txt` and `.xlsx` are accepted.
  `.xlsx` files are decompressed in memory, so a deliberately crafted file could use a lot of RAM.
  Fine for trusted internal files; put authentication and stricter limits in front of it before exposing it to anyone else.
- All user text is escaped in generated SVG, and the UI builds the DOM with `textContent`, so a project name such as `<img onerror=…>` renders as text.

### What it does

| Input | Output |
|---|---|
| Form, or a CSV / XLSX table (one row per transformer, or parameter names down column A) | Rated currents, uk split into ur/ux, equivalent circuit referred to HV and LV, efficiency and voltage regulation, tap table |
| | Single-line diagram and clock-face vector-group diagram (SVG, downloadable) |
| | Efficiency and regulation curves, with hover, keyboard and table view |
| | Bill of materials on screen and as `.xlsx` |

The importer reads English and Italian headers (`Potenza nominale`, `Gruppo vettoriale`,
`Perdite a vuoto`, …), units in brackets (`Rated power [MVA]`), and decimal commas.
Anything it could not map or had to reinterpret is reported as a note instead of
being guessed silently. **Download template** in the UI gives the expected layout.

### What is real and what is a placeholder

**Real, tested against hand calculations:** currents, ur/ux, equivalent circuit,
efficiency, maximum-efficiency load factor, voltage regulation (IEC 60076-1
approximation), tap table, vector-group validation (clock-number parity rules),
terminal counts from the vector group.

**Placeholder: replace before relying on it:**

- `src/bomRules.js`: mass and quantity rules (core, conductor, oil, tank, radiators).
  These are rough scaling laws, not engineering values. Every BOM line that depends
  on them is tagged **Estimate** in the UI and in the Excel export.
- `data/catalog.json`: generic example items, not real products. Replace it with
  your component catalog. Selection picks the smallest voltage class and current
  that fit; anything with no match is shown as **Unmatched**, never dropped.
- The default accessory set in `src/bom.js` (rollers, lifting lugs, …).
- Oil preservation default (hermetic up to 1600 kVA, conservator above) when the
  spec does not say. It is listed under *Assumptions*.

BOM line confidence: **Derived** (follows from the spec) · **Catalog** (picked by
rating) · **Default** (assumed standard set) · **Estimate** (placeholder rule) ·
**Unmatched** (needs a human).

### Layout

```
src/
  fields.js        field registry: drives the schema, importer aliases and web form
  spec.js          validation (zod) + cross-field checks + plausibility warnings
  vectorGroup.js   IEC vector-group parser
  calc.js          electrical performance
  bom.js           BOM generator, catalog selection
  bomRules.js      PLACEHOLDER sizing rules
  schematics.js    SVG single-line and phasor diagrams
  importers/table.js   CSV / XLSX import
  export/bomXlsx.js    Excel export
  server.js        Express API + static files
data/catalog.json  PLACEHOLDER catalog
public/            web UI (vanilla JS, SVG charts, light/dark)
tests/             Jest
```

### API

| Route | |
|---|---|
| `GET /api/fields` | form field definitions |
| `POST /api/design` | JSON spec → `{ ok, spec, warnings, derived, bom, svg }`, or `422 { ok: false, errors: [{field, message}] }` |
| `POST /api/bom.xlsx` | JSON spec → Excel workbook |
| `POST /api/import` | raw `.csv` / `.xlsx` body with `X-Filename` header → candidate specs with per-row validation and notes |
| `GET /api/template.csv` | import template |

### Roadmap

1. **Foundation** (this): data tables → spec, BOM, diagrams, schematics.
2. Parametric 3D model (three.js): core, concentric windings, tank, bushings; glTF export.
3. DXF / DWG ingestion (DWG via LibreDWG or the ODA converter, then `dxf-parser`).
4. PDF and image extraction with the Claude API and a side-by-side review step.
   Note: this sends the files to the API, so confirm that is acceptable for confidential drawings.
5. DXF / IFC export, report templates, accounts if needed.

Not covered yet: single-phase units, step-up transformers, tertiary windings,
short-circuit withstand, temperature-rise and insulation-coordination checks.
