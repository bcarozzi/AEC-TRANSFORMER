const express = require('express');
const path = require('path');
const { FIELDS, DESIGNED_GROUPS } = require('./fields');
const { design } = require('./design');
const { loadCatalog } = require('./bom');
const { importTable } = require('./importers/table');
const { bomWorkbook } = require('./export/bomXlsx');
const { templateCsv } = require('./template');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Field list for the web form, without the importer-only alias tables.
const PUBLIC_FIELDS = FIELDS.map(({ key, label, unit, type, options, required, default: def, section, group, oilOnly, integer }) => ({
  key, label, unit, type, options, required, default: def, section, group, oilOnly, integer,
}));

const safeFilename = (s) => String(s || 'transformer').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'transformer';

function createApp({ catalog = loadCatalog() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // three.js is served from node_modules so the viewer works offline. Only the
  // library build and its add-ons are exposed, not the whole package.
  const threeRoot = path.dirname(path.dirname(require.resolve('three')));
  app.use('/vendor/three/build', express.static(path.join(threeRoot, 'build')));
  app.use('/vendor/three/addons', express.static(path.join(threeRoot, 'examples', 'jsm')));

  app.get('/api/fields', (req, res) => res.json({ fields: PUBLIC_FIELDS, designedGroups: DESIGNED_GROUPS }));

  app.get('/api/template.csv', (req, res) => {
    res.type('text/csv').attachment('transformer-spec-template.csv').send(templateCsv());
  });

  app.post('/api/design', express.json({ limit: '100kb' }), (req, res) => {
    const result = design(req.body, { catalog });
    res.status(result.ok ? 200 : 422).json(result);
  });

  app.post('/api/bom.xlsx', express.json({ limit: '100kb' }), async (req, res, next) => {
    try {
      const result = design(req.body, { catalog });
      if (!result.ok) return res.status(422).json(result);
      const wb = await bomWorkbook(result.spec, result.derived, result.bom);
      const buffer = await wb.xlsx.writeBuffer();
      res.set('Content-Type', XLSX_TYPE);
      res.set('Content-Disposition', `attachment; filename="bom-${safeFilename(result.spec.name)}.xlsx"`);
      return res.send(Buffer.from(buffer));
    } catch (err) {
      return next(err);
    }
  });

  // Raw file body; the original file name (for its extension) comes in X-Filename.
  app.post('/api/import', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Empty upload' });
      }
      let filename = String(req.get('x-filename') || '');
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        // keep the raw header; only its extension matters
      }
      const result = await importTable(req.body, filename);
      return res.json(result);
    } catch (err) {
      if (/Unsupported file type/.test(err.message)) return res.status(415).json({ error: err.message });
      console.error('import failed:', err.message);
      return res.status(422).json({ error: 'Could not read the file. Is it a valid .xlsx or .csv?' });
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    // The importers throw descriptive messages for corrupt files; anything else stays generic.
    return res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3100;
  // Local-only by default: set HOST=0.0.0.0 deliberately to expose it.
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`transformer-designer listening on http://${host}:${port}`);
  });
}
