// three.js viewer for the scene description built in src/geometry.js.
// Loaded on demand (dynamic import) the first time the 3D tab is opened.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MM = 0.001; // the model is in millimetres, the scene in metres (as glTF expects)

// HV blue / LV orange match the schematics. Colours identify the winding, not the real material.
const MATERIALS = {
  core: { color: 0x59616c, metalness: 0.25, roughness: 0.55 },
  'winding-hv': { color: 0x2a78d6, metalness: 0.1, roughness: 0.6 },
  'winding-lv': { color: 0xeb6834, metalness: 0.1, roughness: 0.6 },
  steel: { color: 0x7d858f, metalness: 0.3, roughness: 0.5 },
  cover: { color: 0x66707c, metalness: 0.2, roughness: 0.6 },
  tank: { color: 0x9aa7b5, metalness: 0.15, roughness: 0.6 },
  porcelain: { color: 0xa0653f, metalness: 0.05, roughness: 0.35 },
  accessory: { color: 0xb4bcc5, metalness: 0.2, roughness: 0.5 },
};
// Surfaces that turn translucent in X-ray mode, so the active part can be seen through them.
const XRAY = {
  shell: { xray: 0.18, solid: 0.96 }, // the tank itself
  cooling: { xray: 0.4, solid: 0.96 }, // fins and radiators
};

const cssColor = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
};

function lathe(profile, segments) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * MM, y * MM)), segments);
}

function geometryFor(p) {
  const [sx, sy, sz] = p.size;
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(sx * MM, sy * MM, sz * MM);
    case 'cylinder': {
      const g = new THREE.CylinderGeometry(p.radius * MM, p.radius * MM, p.height * MM, 48);
      if (p.axis === 'x') g.rotateZ(Math.PI / 2);
      if (p.axis === 'z') g.rotateX(Math.PI / 2);
      return g;
    }
    case 'tube': {
      const h = p.height / 2;
      return lathe([[p.innerRadius, -h], [p.outerRadius, -h], [p.outerRadius, h], [p.innerRadius, h], [p.innerRadius, -h]], 64);
    }
    case 'bushing': {
      // Flange, then alternating sheds up a slim core, capped at the top.
      const h = p.height;
      const rc = p.radius * 0.45;
      const profile = [[0, -h / 2], [p.radius, -h / 2], [p.radius, -h / 2 + 12], [rc, -h / 2 + 12]];
      const span = h - 12 - 14;
      for (let i = 0; i < p.sheds; i += 1) {
        const y = -h / 2 + 12 + 6 + (span * i) / p.sheds;
        profile.push([rc, y], [p.radius * 0.95, y + 4], [p.radius * 0.8, y + 9], [rc, y + 11]);
      }
      profile.push([rc, h / 2 - 8], [p.radius * 0.55, h / 2 - 8], [p.radius * 0.55, h / 2], [0, h / 2]);
      return lathe(profile, 40);
    }
    case 'fins': {
      const n = Math.max(2, Math.floor(sx / p.pitch));
      const boxes = [];
      for (let i = 0; i < n; i += 1) {
        const g = new THREE.BoxGeometry(p.thickness * MM, sy * MM, sz * MM);
        g.translate((-sx / 2 + (i + 0.5) * (sx / n)) * MM, 0, 0);
        boxes.push(g);
      }
      return mergeGeometries(boxes);
    }
    default:
      throw new Error(`Unknown shape ${p.shape}`);
  }
}

function isVisibleDeep(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function createViewer(container, { onHover } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    return null; // no WebGL: the caller shows a message
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; // render on demand, no animation loop
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a0, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(-4, 2, -3);
  scene.add(key, fill);

  const root = new THREE.Group();
  scene.add(root);
  let grid = null;
  const layers = new Map();
  const materials = new Map();
  const xrayMaterials = new Map(); // material -> opacities
  let xray = true;
  let radius = 0;
  let center = new THREE.Vector3();
  let frame = 0;

  function material(keyName) {
    if (!materials.has(keyName)) materials.set(keyName, new THREE.MeshStandardMaterial({ ...MATERIALS[keyName], side: THREE.DoubleSide }));
    return materials.get(keyName);
  }

  function applyXray() {
    xrayMaterials.forEach((o, m) => {
      m.opacity = xray ? o.xray : o.solid;
      m.depthWrite = !xray;
      m.needsUpdate = true;
    });
  }

  function xrayMaterial(kind) {
    const m = new THREE.MeshStandardMaterial({ ...MATERIALS.tank, transparent: true, side: THREE.DoubleSide });
    xrayMaterials.set(m, XRAY[kind]);
    return m;
  }

  function applyTheme() {
    scene.background = cssColor('--surface-2', '#f0efec');
    if (grid) grid.material.color = cssColor('--line', '#dcdbd5');
    requestRender();
  }

  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  }
  controls.addEventListener('change', requestRender);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', applyTheme);

  function clear() {
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    root.clear();
    layers.clear();
    xrayMaterials.forEach((o, m) => m.dispose());
    xrayMaterials.clear();
  }

  function fit(direction = [0.8, 0.55, 1]) {
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.position.copy(center).addScaledVector(new THREE.Vector3(...direction).normalize(), dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    requestRender();
  }

  function setModel(model) {
    clear();
    model.parts.forEach((p) => {
      let mesh;
      const geometry = geometryFor(p);
      if (p.id === 'tank-body') {
        mesh = new THREE.Mesh(geometry, xrayMaterial('shell'));
      } else if (p.shape === 'fins' || p.name === 'Radiator panel') {
        mesh = new THREE.Mesh(geometry, xrayMaterial('cooling'));
      } else {
        mesh = new THREE.Mesh(geometry, material(p.material));
      }
      mesh.position.set(p.position[0] * MM, p.position[1] * MM, p.position[2] * MM);
      mesh.userData.part = p;
      mesh.name = p.name;
      if (p.id === 'tank-body' || p.id === 'tank-cover') {
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x3b4450 })));
      }
      if (!layers.has(p.layer)) {
        const g = new THREE.Group();
        g.name = p.layer;
        layers.set(p.layer, g);
        root.add(g);
      }
      layers.get(p.layer).add(mesh);
    });
    applyXray();

    const [mn, mx] = [model.bounds.min, model.bounds.max].map((v) => new THREE.Vector3(...v).multiplyScalar(MM));
    const nextCenter = mn.clone().add(mx).multiplyScalar(0.5);
    const nextRadius = mx.clone().sub(mn).length() / 2;
    const ratio = radius ? nextRadius / radius : 0;
    center = nextCenter;
    const refit = !radius || ratio < 0.87 || ratio > 1.15;
    radius = nextRadius;

    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(Math.max(2, Math.ceil(radius * 6)), Math.max(10, Math.ceil(radius * 6) * 4));
    scene.add(grid);
    applyTheme();
    if (refit) fit(); else requestRender();
  }

  // --- hover labels ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverQueued = false;
  let lastEvent = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    lastEvent = e;
    if (hoverQueued || !onHover) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((lastEvent.clientX - rect.left) / rect.width) * 2 - 1, -((lastEvent.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(root.children, true)
        .find((h) => h.object.isMesh && isVisibleDeep(h.object) && !(xray && xrayMaterials.has(h.object.material)));
      onHover(hit ? hit.object.userData.part : null, lastEvent.clientX - rect.left, lastEvent.clientY - rect.top);
    });
  });
  renderer.domElement.addEventListener('pointerleave', () => onHover && onHover(null));

  return {
    setModel,
    resize,
    fit: () => fit(),
    setLayerVisible(layer, visible) {
      const g = layers.get(layer);
      if (g) g.visible = visible;
      requestRender();
    },
    setXray(on) {
      xray = on;
      applyXray();
      requestRender();
    },
    setView(name) {
      fit({ front: [0, 0.12, 1], side: [1, 0.12, 0], top: [0, 1, 0.001], iso: [0.8, 0.55, 1] }[name] || [0.8, 0.55, 1]);
    },
    // Exports what is currently visible, in metres, as a binary glTF.
    exportGlb() {
      return new Promise((resolve, reject) => {
        new GLTFExporter().parse(root, (buf) => resolve(new Blob([buf], { type: 'model/gltf-binary' })), reject, { binary: true });
      });
    },
    dispose() {
      observer.disconnect();
      media.removeEventListener('change', applyTheme);
      cancelAnimationFrame(frame);
      clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
