import { LEN20, HEIGHT, WIDTH, seeded, createContainerKit } from './containerKit';

// Mini-pátio 3D do Dashboard ("Estoque Atual no Pátio"): os contêineres em
// estoque empilhados num bloco, cheios de um lado (verde) e vazios do outro
// (cinza), sobre um trecho de pátio. Na entrada eles descem um a um, como se
// o guindaste estivesse montando a pilha; depois a câmera faz um vaivém lento.
//
// O bloco comporta até 80 contêineres desenhados; com estoque maior, cada
// contêiner do modelo passa a valer 2, 5, 10... unidades (yardPlan devolve
// essa escala pra tela avisar).
//
// Usado pelo Stage3D: yardScene(ctx, params), params = { full, empty }.

const BAY = LEN20 + 0.09;
const ROW = WIDTH + 0.14;
const TIER = HEIGHT + 0.012;
const ROWS = 4;
const MAX_BAYS = 5;
const MAX_TIERS = 4;
const CAPACITY = MAX_BAYS * ROWS * MAX_TIERS;

export const YARD_COLORS = { full: 0x19a36c, empty: 0x9aa7b5 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;

/** Quantos contêineres desenhar e quanto cada um representa. */
export function yardPlan(full, empty) {
  const f = Math.max(0, Math.round(Number(full) || 0));
  const e = Math.max(0, Math.round(Number(empty) || 0));
  const steps = [1, 2, 5];
  for (let i = 0; ; i += 1) {
    const unit = steps[i % 3] * 10 ** Math.floor(i / 3);
    const nFull = f > 0 ? Math.max(1, Math.round(f / unit)) : 0;
    const nEmpty = e > 0 ? Math.max(1, Math.round(e / unit)) : 0;
    const n = nFull + nEmpty;
    const tiers = n <= 8 ? 2 : n <= 24 ? 3 : MAX_TIERS;
    const perBay = ROWS * tiers;
    const bays = Math.ceil(nFull / perBay) + Math.ceil(nEmpty / perBay);
    if (bays <= MAX_BAYS) return { unit, nFull, nEmpty, tiers, perBay, bays };
  }
}

// Posição de cada contêiner: enche uma pilha até o topo antes de abrir a
// próxima; os vazios começam numa baia nova, separados dos cheios
function layout(plan) {
  const slots = { full: [], empty: [] };
  const place = (kind, count, firstBay) => {
    for (let i = 0; i < count; i += 1) {
      const within = i % plan.perBay;
      slots[kind].push({
        bay: firstBay + Math.floor(i / plan.perBay),
        row: Math.floor(within / plan.tiers),
        tier: within % plan.tiers,
      });
    }
  };
  place('full', plan.nFull, 0);
  place('empty', plan.nEmpty, Math.ceil(plan.nFull / plan.perBay));
  const all = [...slots.full, ...slots.empty];
  const rows = all.length ? Math.max(...all.map((s) => s.row)) + 1 : 1;
  const tiers = all.length ? Math.max(...all.map((s) => s.tier)) + 1 : 1;
  const bays = Math.max(1, plan.bays);
  const toWorld = (s) => ({
    // Cheios na ponta mais próxima da câmera; as pilhas crescem da frente pra trás
    x: ((bays - 1) / 2 - s.bay) * BAY,
    y: HEIGHT / 2 + s.tier * TIER,
    z: ((rows - 1) / 2 - s.row) * ROW,
  });
  return {
    full: slots.full.map(toWorld),
    empty: slots.empty.map(toWorld),
    size: { x: bays * BAY, y: tiers * TIER, z: rows * ROW },
  };
}

function paintAsphalt(ctx, size, rand) {
  ctx.fillStyle = '#3a454d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${0.02 + rand() * 0.05})` : `rgba(0,0,0,${0.05 + rand() * 0.1})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 10 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.08 + rand() * 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

export function yardScene(ctx, initial) {
  const { THREE, scene, renderer, track, mergeGeometries } = ctx;
  renderer.toneMappingExposure = 1.12;
  scene.environmentIntensity = 0.5;
  const rand = seeded(20261004);

  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x55606a, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-9, 15, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const root = new THREE.Group();
  scene.add(root);

  // ----- Trecho de pátio: laje de concreto com asfalto em cima e a faixa
  // amarela que delimita o bloco -----
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 256;
  asphaltCanvas.height = 256;
  paintAsphalt(asphaltCanvas.getContext('2d'), 256, rand);
  const asphaltTexture = track(new THREE.CanvasTexture(asphaltCanvas));
  asphaltTexture.colorSpace = THREE.SRGBColorSpace;
  const asphalt = track(new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.95, metalness: 0 }));
  const curb = track(new THREE.MeshStandardMaterial({ color: 0xa3adb5, roughness: 0.9, metalness: 0 }));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  // Ordem das faces do BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
  const pad = new THREE.Mesh(unitBox, [curb, curb, asphalt, curb, curb, curb]);
  pad.receiveShadow = true;
  root.add(pad);
  const linePaint = track(new THREE.MeshStandardMaterial({ color: 0xe6bd32, roughness: 0.8, metalness: 0 }));
  const lines = [0, 1, 2, 3].map(() => {
    const line = new THREE.Mesh(unitBox, linePaint);
    line.receiveShadow = true;
    root.add(line);
    return line;
  });
  const placePad = (size) => {
    const w = size.x + 2.2;
    const d = size.z + 2.2;
    pad.scale.set(w, 0.22, d);
    pad.position.y = -0.11;
    const lx = size.x / 2 + 0.45;
    const lz = size.z / 2 + 0.45;
    lines[0].scale.set(lx * 2 + 0.07, 0.012, 0.07);
    lines[0].position.set(0, 0.006, lz);
    lines[1].scale.set(lx * 2 + 0.07, 0.012, 0.07);
    lines[1].position.set(0, 0.006, -lz);
    lines[2].scale.set(0.07, 0.012, lz * 2 + 0.07);
    lines[2].position.set(lx, 0.006, 0);
    lines[3].scale.set(0.07, 0.012, lz * 2 + 0.07);
    lines[3].position.set(-lx, 0.006, 0);
  };

  // ----- Contêineres (instanciados: um desenho por cor, não por unidade) -----
  const kit = createContainerKit(THREE, {
    mergeGeometries, track, rand, maxAniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const makeKind = (color) => {
    const look = kit.look(color, 'CLX');
    const body = track(new THREE.InstancedMesh(kit.bodyGeo[20], look[20], CAPACITY));
    const frame = track(new THREE.InstancedMesh(kit.frameGeo[20], look.frame, CAPACITY));
    [body, frame].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      root.add(m);
    });
    return { body, frame, items: [] };
  };
  const kinds = { full: makeKind(YARD_COLORS.full), empty: makeKind(YARD_COLORS.empty) };

  // ----- Estado -----
  let plan = null;
  let size = { x: BAY, y: TIER, z: ROW };
  let now = 0;
  let settled = false;
  const DROP = 0.55;      // duração da descida de um contêiner
  const DROP_HEIGHT = 3.4;

  const arrange = (params, intro) => {
    const next = yardPlan(params?.full, params?.empty);
    const sameScale = plan && plan.unit === next.unit && plan.tiers === next.tiers && plan.bays === next.bays;
    const placed = layout(next);
    const total = next.nFull + next.nEmpty;
    const step = Math.min(0.035, 1.3 / Math.max(1, total));
    let order = 0;
    ['full', 'empty'].forEach((kind) => {
      const before = kinds[kind].items.length;
      kinds[kind].items = placed[kind].map((p, i) => {
        // Na entrada todos descem em sequência; depois, só os que chegaram
        let start = -DROP;
        if (intro) start = 0.2 + order * step;
        else if (sameScale && i >= before) start = now + (i - before) * 0.12;
        order += 1;
        return { ...p, start, yaw: (rand() - 0.5) * 0.012 };
      });
      kinds[kind].body.count = placed[kind].length;
      kinds[kind].frame.count = placed[kind].length;
    });
    plan = next;
    size = placed.size;
    placePad(size);
    settled = false;
  };

  const dummy = new THREE.Object3D();
  const placeContainers = (time) => {
    let moving = false;
    Object.values(kinds).forEach(({ body, frame, items }) => {
      items.forEach((item, i) => {
        const p = (time - item.start) / DROP;
        if (p < 1) moving = true;
        const scale = p <= 0 ? 0.0001 : 1;
        dummy.position.set(item.x, item.y + (1 - easeOut(p)) * DROP_HEIGHT, item.z);
        dummy.rotation.set(0, item.yaw, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        body.setMatrixAt(i, dummy.matrix);
        frame.setMatrixAt(i, dummy.matrix);
      });
      body.instanceMatrix.needsUpdate = true;
      frame.instanceMatrix.needsUpdate = true;
    });
    settled = !moving;
  };

  arrange(initial, true);

  // ----- Câmera: enquadra o bloco (do tamanho que estiver) e orbita devagar -----
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const focus = new THREE.Vector3();
  let aspect = 1;
  let radius = 0;
  const ANGLE = 0.74;      // direção média da câmera
  const SWING = 0.3;       // vaivém pra cada lado
  const ELEVATION = 0.5;
  // Distância em que a caixa do bloco (com a laje) cabe inteira na tela, vista
  // de uma direção: metade da largura e da altura projetadas, mais a metade da
  // profundidade (o que está mais perto da câmera aparece maior)
  const fitAt = (angle) => {
    const hx = size.x / 2 + 1.15;
    const hy = size.y / 2 + 0.15;
    const hz = size.z / 2 + 1.15;
    const sa = Math.abs(Math.sin(angle));
    const ca = Math.abs(Math.cos(angle));
    const se = Math.sin(ELEVATION);
    const ce = Math.cos(ELEVATION);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const width = hx * ca + hz * sa;
    const height = (hx * sa + hz * ca) * se + hy * ce;
    const depth = (hx * sa + hz * ca) * ce + hy * se;
    return Math.max(height / tan, width / (tan * aspect)) + depth;
  };
  // O pior caso do vaivém, pra nada sair do quadro em nenhum ponto dele
  const fitRadius = () => Math.max(fitAt(ANGLE - SWING), fitAt(ANGLE), fitAt(ANGLE + SWING)) * 0.9;
  const resize = (nextAspect) => { aspect = nextAspect; };

  const update = (time, delta) => {
    now = time;
    if (!settled) placeContainers(time);

    const wanted = fitRadius();
    radius = radius ? radius + (wanted - radius) * (1 - Math.exp(-delta * 4)) : wanted;
    focus.set(0, size.y * 0.3, 0);
    const intro = 1 - easeOut(time / 1.6);
    const angle = ANGLE + Math.sin(time * 0.22) * SWING + ctx.pointer.x * 0.12 + intro * 0.4;
    const elevation = ELEVATION - ctx.pointer.y * 0.05;
    const d = radius * (1 + intro * 0.1);
    camera.position.set(
      focus.x + Math.sin(angle) * Math.cos(elevation) * d,
      focus.y + Math.sin(elevation) * d,
      focus.z + Math.cos(angle) * Math.cos(elevation) * d,
    );
    camera.lookAt(focus);
  };

  return {
    camera,
    update,
    resize,
    idle: () => settled && now > 2,
    setParams(next) { arrange(next, false); },
  };
}
