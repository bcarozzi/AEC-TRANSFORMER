const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../src/server');
const { typical } = require('./fixtures');

const app = createApp();

// The import route logs unreadable files; keep that out of the test output.
beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { console.error.mockRestore(); });

describe('API', () => {
  test('GET /api/fields lists the form fields without importer internals', async () => {
    const res = await request(app).get('/api/fields').expect(200);
    const keys = res.body.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['ratedPowerKva', 'vectorGroup', 'pkW']));
    expect(res.body.fields.every((f) => !('aliases' in f))).toBe(true);
  });

  test('POST /api/design returns derived values, BOM and SVGs', async () => {
    const res = await request(app).post('/api/design').send(typical).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.derived.currents.hvA).toBeCloseTo(28.8675, 3);
    expect(res.body.bom.lines.length).toBeGreaterThan(10);
    expect(res.body.svg.singleLine).toMatch(/^<svg/);
    expect(res.body.svg.phasor).toMatch(/^<svg/);
  });

  test('POST /api/design includes the 3D scene description', async () => {
    const res = await request(app).post('/api/design').send(typical).expect(200);
    expect(res.body.model.units).toBe('mm');
    expect(res.body.model.estimate).toBe(true);
    expect(res.body.model.parts.length).toBeGreaterThan(30);
    expect(res.body.model.overall.heightMm).toBeGreaterThan(0);
  });

  test('serves three.js and its add-ons locally, and nothing else from the package', async () => {
    const core = await request(app).get('/vendor/three/build/three.module.js').expect(200);
    expect(core.headers['content-type']).toMatch(/javascript/);
    await request(app).get('/vendor/three/addons/controls/OrbitControls.js').expect(200);
    await request(app).get('/vendor/three/addons/exporters/GLTFExporter.js').expect(200);
    await request(app).get('/vendor/three/package.json').expect(404);
    await request(app).get('/vendor/three/build/../package.json').expect(404);
    await request(app).get('/vendor/three/addons/%2e%2e/%2e%2e/package.json').expect(404);
  });

  test('the page declares an import map for the local copy', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('"three": "/vendor/three/build/three.module.js"');
    expect(res.text).toContain('"three/addons/": "/vendor/three/addons/"');
  });

  test('POST /api/design returns 422 with field errors for a bad spec', async () => {
    const res = await request(app).post('/api/design').send({ ...typical, vectorGroup: 'Dyn10', p0W: -1 }).expect(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.map((e) => e.field).sort()).toEqual(['p0W', 'vectorGroup']);
  });

  test('POST /api/design survives non-object bodies', async () => {
    await request(app).post('/api/design').send([1, 2, 3]).expect(422);
    await request(app).post('/api/design').set('Content-Type', 'application/json').send('{bad').expect(400);
  });

  test('POST /api/design rejects oversized bodies', async () => {
    await request(app).post('/api/design').send({ name: 'x'.repeat(200_000) }).expect(413);
  });

  test('POST /api/bom.xlsx returns a workbook with the BOM', async () => {
    const res = await request(app)
      .post('/api/bom.xlsx').send({ ...typical, name: 'Plant / A "1"' })
      .buffer().parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="bom-Plant_A_1_.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['BOM', 'Notes', 'Specification']);
    const bom = wb.getWorksheet('BOM');
    const items = [];
    bom.eachRow((row) => items.push(row.getCell(3).value));
    expect(items).toContain('HV bushing (phase)');
  });

  test('POST /api/bom.xlsx returns 422 for a bad spec', async () => {
    await request(app).post('/api/bom.xlsx').send({}).expect(422);
  });

  test('POST /api/import reads an uploaded CSV', async () => {
    const csv = 'Rated power [kVA],HV [kV],LV [kV],Vector group,uk [%],P0 [W],Pk [W]\n1000,20,0.4,Dyn11,6,1100,10500\n';
    const res = await request(app).post('/api/import').set('X-Filename', 'a.csv').set('Content-Type', 'text/csv').send(csv).expect(200);
    expect(res.body.specs[0].validation.ok).toBe(true);
  });

  test('POST /api/import: empty, wrong type and corrupt uploads', async () => {
    await request(app).post('/api/import').set('X-Filename', 'a.csv').set('Content-Type', 'text/csv').send('').expect(400);
    await request(app).post('/api/import').set('X-Filename', 'plan.dwg').set('Content-Type', 'application/octet-stream').send('AC1032').expect(415);
    await request(app).post('/api/import').set('X-Filename', 'x.xlsx').set('Content-Type', 'application/octet-stream').send('garbage').expect(422);
    await request(app).post('/api/import').set('X-Filename', '%E0%A4%A').set('Content-Type', 'text/plain').send('x').expect(415);
  });

  test('GET /api/template.csv downloads the template', async () => {
    const res = await request(app).get('/api/template.csv').expect(200);
    expect(res.headers['content-disposition']).toMatch(/transformer-spec-template\.csv/);
    expect(res.text).toMatch(/^Parameter,Value,Unit,Notes/);
  });

  test('does not advertise Express', async () => {
    const res = await request(app).get('/api/fields');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
