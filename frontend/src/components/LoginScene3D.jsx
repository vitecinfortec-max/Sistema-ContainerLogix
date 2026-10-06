import { useEffect, useRef, useState } from 'react';
import { LEN20, HEIGHT, WIDTH, seeded, createContainerKit } from './three/containerKit';
import { createParts, noiseTile } from './three/sceneParts';
import { rtgMaterials, buildRtg } from './three/rtgCrane';
import { truckMaterials, buildTruck } from './three/truck';
import { skyU, paintSky, buildPort } from './three/portBackdrop';
import { prefilterEnvironment } from './three/environment';

// Cena 3D da tela de login: um terminal de contêineres no fim da tarde. Na
// quadra do meio, um guindaste de pórtico (RTG) tira um contêiner da pilha e
// carrega um caminhão; o caminhão sai e outro chega pra descarregar. Em volta,
// o resto do pátio (outras quadras, postes, outros guindastes) e, lá no fundo
// na névoa, o cais com um navio atracado. A câmera orbita devagar e acompanha
// o mouse.
//
// O que dá a cara de foto: sol baixo com sombras compridas, céu que também
// ilumina e aparece nos reflexos, névoa de distância, asfalto com remendos,
// marcações gastas, manchas e poças, e modelos em escala (1 unidade = 2 m).
//
// O three.js é carregado sob demanda (import dinâmico), então só pesa nesta
// tela - e só em telas largas, onde o painel aparece. Sem WebGL fica o fundo
// em degradê; com "reduzir movimento" ligado, um único quadro parado.
// Nada aqui usa arquivo externo: texturas e céu são desenhados em canvas.

const DESKTOP_QUERY = '(min-width: 1024px)';

const BAY = LEN20 + 0.07; // passo de um slot de 20' (dois slots = um de 40')
const ROW = WIDTH + 0.16;
const TIER = HEIGHT + 0.012;
const BAYS = 6;
const ROWS = 5;

const PALETTE = [0x8c2f2a, 0x1f5f9e, 0x00897a, 0xd96a1f, 0x6f7a86, 0x2e7d4f, 0xd4a017, 0xd9dee4, 0x263c6b, 0x4f9ad1];
const WORDMARKS = ['CLX', 'LOGIX', 'CLX LINE', 'CLX', 'CONTAINERLOGIX', 'CLX', 'LOGIX', 'CLX LINE', 'CLX', 'LOGIX'];

const slotX = (bay) => (bay - (BAYS - 1) / 2) * BAY;
const rowZ = (row) => (row - (ROWS - 1) / 2) * ROW;
const tierY = (tier) => HEIGHT / 2 + tier * TIER;
const BLOCK_LENGTH = BAYS * BAY;
const BLOCK_DEPTH = ROWS * ROW;
const LANE_Z = BLOCK_DEPTH / 2 + 1.25;       // faixa do caminhão, na frente da quadra
const Z_BACK = -(BLOCK_DEPTH / 2 + 0.8);     // pistas de rolamento do pórtico
const Z_FRONT = LANE_Z + 1.25;

// O terminal: quadras iguais lado a lado e em fila até o cais. A (0, 0) é a
// da animação; as outras só têm pilhas paradas.
const PITCH_X = BLOCK_LENGTH + 5;            // quadra + rua transversal
const PITCH_Z = 13.2;                        // quadra + faixa + rua de serviço
const BLOCKS = [];
[-3, -2, -1, 0, 1].forEach((i) => [0, -1, -2].forEach((j) => {
  BLOCKS.push({ x: i * PITCH_X, z: j * PITCH_Z, letter: 'ABCDEFGHIJKLMNO'[(i + 3) * 3 - j], main: i === 0 && j === 0 });
}));
// Mais pra trás, até a retroárea do cais: só as pilhas, já na névoa
const FAR_BLOCKS = [];
[-6, -5, -4, -3, -2, -1, 0, 1].forEach((i) => [-3, -4, -5, -6].forEach((j) => FAR_BLOCKS.push({ x: i * PITCH_X, z: j * PITCH_Z })));
const QUAY_Z = -120;
const GROUND = 110;                          // lado do trecho de piso detalhado

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ramp = (t, a, b) => smooth(clamp01((t - a) / (b - a)));

// ---------- Piso desenhado em canvas ----------

// Poças (x, z, raio): escurecem o asfalto e viram espelho no mapa de rugosidade
const PUDDLES = [
  [-7.5, LANE_Z + 0.55, 1.3], [5.5, 8.3, 1.7], [-12.2, -5.6, 1.5], [11.9, 3.4, 1.2], [-3, 12.4, 2.1],
];

function paintGround(ctx, size, { rand }) {
  const px = size / GROUND;
  const c = size / 2;
  const P = (u) => c + u * px; // unidade do mundo -> pixel (vale pra x e pra z)

  ctx.fillStyle = '#4b4e50';
  ctx.fillRect(0, 0, size, size);
  // Remendos: panos de asfalto mais novo ou mais gasto
  for (let i = 0; i < 36; i += 1) {
    const w = (5 + rand() * 18) * px;
    const h = (3 + rand() * 9) * px;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${0.02 + rand() * 0.05})` : `rgba(0,0,0,${0.05 + rand() * 0.1})`;
    ctx.fillRect(rand() * size - w / 2, rand() * size - h / 2, w, h);
  }
  // Granulado
  ctx.fillStyle = ctx.createPattern(noiseTile(rand, 512, 0.55, 0.09, 0.2), 'repeat');
  ctx.fillRect(0, 0, size, size);

  // Pistas de concreto do pórtico, com juntas e a marca dos pneus
  BLOCKS.forEach(({ x, z }) => {
    [Z_BACK, Z_FRONT].forEach((rz) => {
      const y = P(z + rz);
      const x0 = P(x - PITCH_X / 2);
      ctx.fillStyle = 'rgba(150,151,147,0.9)';
      ctx.fillRect(x0, y - 0.55 * px, PITCH_X * px, 1.1 * px);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      for (let j = x0; j < x0 + PITCH_X * px; j += 3 * px) ctx.fillRect(j, y - 0.55 * px, 1.5, 1.1 * px);
      ctx.fillStyle = 'rgba(18,18,18,0.3)';
      ctx.fillRect(x0, y - 0.17 * px, PITCH_X * px, 0.34 * px);
    });
  });

  // Sombra de contato embaixo de cada pilha
  // (desenhada pequena e ampliada: a ampliação já deixa a borda esfumada)
  const contact = document.createElement('canvas');
  contact.width = size / 8;
  contact.height = size / 8;
  const k = contact.getContext('2d');
  const K = (u) => (c + u * px) / 8;
  k.fillStyle = '#080808';
  BLOCKS.forEach(({ x, z }) => {
    for (let bay = 0; bay < BAYS; bay += 1) {
      for (let row = 0; row < ROWS; row += 1) {
        k.fillRect(K(x + slotX(bay) - LEN20 / 2 - 0.22), K(z + rowZ(row) - WIDTH / 2 - 0.22), ((LEN20 + 0.44) * px) / 8, ((WIDTH + 0.44) * px) / 8);
      }
    }
  });
  ctx.globalAlpha = 0.6;
  ctx.drawImage(contact, 0, 0, size, size);
  ctx.globalAlpha = 1;

  // ----- Pintura de sinalização, numa camada à parte pra poder "gastar" -----
  const layer = document.createElement('canvas');
  layer.width = size;
  layer.height = size;
  const m = layer.getContext('2d');
  const YELLOW = '#e2b72e';
  const WHITE = '#e8ebeb';
  const dashed = (color, x0, z0, x1, z1, dash, gap, widthPx) => {
    m.strokeStyle = color;
    m.lineWidth = widthPx;
    m.setLineDash([dash * px, gap * px]);
    m.beginPath();
    m.moveTo(P(x0), P(z0));
    m.lineTo(P(x1), P(z1));
    m.stroke();
    m.setLineDash([]);
  };
  const lineW = Math.max(1.5, 0.075 * px);
  BLOCKS.forEach(({ x, z, letter }) => {
    // Vagas dos contêineres
    m.strokeStyle = YELLOW;
    m.lineWidth = lineW;
    for (let bay = 0; bay < BAYS; bay += 1) {
      for (let row = 0; row < ROWS; row += 1) {
        m.strokeRect(P(x + slotX(bay) - LEN20 / 2 - 0.02), P(z + rowZ(row) - WIDTH / 2 - 0.05), (LEN20 + 0.04) * px, (WIDTH + 0.1) * px);
      }
    }
    // Faixa do caminhão: bordas contínuas e setas de sentido
    m.fillStyle = WHITE;
    [-0.92, 0.92].forEach((dz) => m.fillRect(P(x - PITCH_X / 2), P(z + LANE_Z + dz) - lineW / 2, PITCH_X * px, lineW));
    [-6.6, 0.4, 7.4].forEach((ax) => {
      const ox = P(x + ax);
      const oz = P(z + LANE_Z);
      m.beginPath();
      m.moveTo(ox - 0.8 * px, oz - 0.09 * px);
      m.lineTo(ox + 0.2 * px, oz - 0.09 * px);
      m.lineTo(ox + 0.2 * px, oz - 0.3 * px);
      m.lineTo(ox + 0.8 * px, oz);
      m.lineTo(ox + 0.2 * px, oz + 0.3 * px);
      m.lineTo(ox + 0.2 * px, oz + 0.09 * px);
      m.lineTo(ox - 0.8 * px, oz + 0.09 * px);
      m.closePath();
      m.fill();
    });
    // Endereço de cada baia, pintado do lado de fora da pista do pórtico
    m.font = `700 ${Math.round(0.6 * px)}px Arial, sans-serif`;
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    for (let bay = 0; bay < BAYS; bay += 1) {
      m.fillText(`${letter}${String(bay + 1).padStart(2, '0')}`, P(x + slotX(bay)), P(z + Z_FRONT + 1.1));
    }
    // Eixo da rua de serviço atrás da quadra e bordas da rua transversal
    dashed(YELLOW, x - PITCH_X / 2, z + Z_BACK - 1.5, x + PITCH_X / 2, z + Z_BACK - 1.5, 1.2, 1.2, lineW);
    dashed(WHITE, x + BLOCK_LENGTH / 2 + 0.6, z + Z_BACK - 0.8, x + BLOCK_LENGTH / 2 + 0.6, z + Z_FRONT + 0.8, 0.9, 0.7, lineW);
    dashed(WHITE, x - BLOCK_LENGTH / 2 - 0.6, z + Z_BACK - 0.8, x - BLOCK_LENGTH / 2 - 0.6, z + Z_FRONT + 0.8, 0.9, 0.7, lineW);
  });
  // Na frente: via de acesso e vagas de espera em espinha de peixe
  dashed(YELLOW, -GROUND / 2, 10.6, GROUND / 2, 10.6, 1.4, 1.4, lineW);
  m.strokeStyle = WHITE;
  m.lineWidth = lineW;
  for (let x = -44; x <= 44; x += 2.3) {
    m.beginPath();
    m.moveTo(P(x), P(13.2));
    m.lineTo(P(x + 2.6), P(19.6));
    m.stroke();
  }
  m.fillStyle = WHITE;
  m.fillRect(P(-44), P(13.2) - lineW / 2, 90.6 * px, lineW);
  // Tinta gasta: some em pontinhos
  m.globalCompositeOperation = 'destination-out';
  const chips = noiseTile(rand, 256, 0.3, 0.85, 0.85);
  m.fillStyle = m.createPattern(chips, 'repeat');
  m.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 768) for (let y = 0; y < size; y += 768) m.drawImage(chips, x, y, 768, 768); // lascas maiores
  ctx.globalAlpha = 0.8;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;

  // Borracha de pneu nas faixas e nas ruas de serviço
  BLOCKS.forEach(({ x, z }) => {
    [[LANE_Z, 0.24], [Z_BACK - 1.5, 0.13]].forEach(([lz, alpha]) => {
      [-0.47, 0.47].forEach((dz) => {
        const g = ctx.createLinearGradient(0, P(z + lz + dz - 0.16), 0, P(z + lz + dz + 0.16));
        g.addColorStop(0, 'rgba(14,14,14,0)');
        g.addColorStop(0.5, `rgba(14,14,14,${alpha})`);
        g.addColorStop(1, 'rgba(14,14,14,0)');
        ctx.fillStyle = g;
        ctx.fillRect(P(x - PITCH_X / 2), P(z + lz + dz - 0.16), PITCH_X * px, 0.32 * px);
      });
    });
  });
  // Curvas de quem entra e sai das ruas transversais
  ctx.strokeStyle = 'rgba(14,14,14,0.16)';
  ctx.lineWidth = 0.22 * px;
  [-1, 0].forEach((i) => [0, -1, -2].forEach((j) => {
    const ax = i * PITCH_X + PITCH_X / 2;
    const az = j * PITCH_Z + LANE_Z;
    [3.2, 4.1].forEach((r) => {
      ctx.beginPath();
      ctx.arc(P(ax - r - 0.6), P(az + r), r * px, -Math.PI / 2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(P(ax + r + 0.6), P(az - r), r * px, Math.PI / 2, Math.PI);
      ctx.stroke();
    });
  }));
  // Manchas de óleo (mais onde o caminhão para) e trincas
  for (let i = 0; i < 110; i += 1) {
    const near = i < 14;
    const x = near ? P(slotX(2) + (rand() - 0.5) * 5) : rand() * size;
    const y = near ? P(LANE_Z + (rand() - 0.5) * 1.2) : rand() * size;
    const r = (0.25 + rand() * (near ? 0.5 : 1.3)) * px;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(8,8,8,${0.1 + rand() * 0.2})`);
    g.addColorStop(1, 'rgba(8,8,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.34)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i += 1) {
    let x = rand() * size;
    let y = rand() * size;
    let heading = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6 + rand() * 6; s += 1) {
      heading += (rand() - 0.5) * 1.3;
      x += Math.cos(heading) * (0.5 + rand()) * px;
      y += Math.sin(heading) * (0.5 + rand()) * px;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Asfalto molhado é mais escuro
  PUDDLES.forEach(([ux, uz, ur]) => {
    for (let i = 0; i < 6; i += 1) {
      const x = P(ux + (rand() - 0.5) * ur * 1.4);
      const y = P(uz + (rand() - 0.5) * ur * 0.7);
      const r = ur * (0.5 + rand() * 0.6) * px;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(10,12,14,0.3)');
      g.addColorStop(1, 'rgba(10,12,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  });

  // Some pras bordas: em volta continua o piso liso, até a névoa
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(c, c, size * 0.4, c, c, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
}

// Mapa de rugosidade do piso: claro = fosco; onde o asfalto está úmido ele
// fica mais liso e pega um brilho do céu
function paintRoughness(ctx, size, { rand }) {
  const px = size / GROUND;
  const c = size / 2;
  const P = (u) => c + u * px;
  ctx.fillStyle = '#ededed';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i += 1) {
    const v = Math.round(205 + rand() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(rand() * size, rand() * size, (3 + rand() * 12) * px, (2 + rand() * 7) * px);
  }
  ctx.fillStyle = '#cdcdcd';
  BLOCKS.forEach(({ x, z }) => [Z_BACK, Z_FRONT].forEach((rz) => ctx.fillRect(P(x - PITCH_X / 2), P(z + rz - 0.55), PITCH_X * px, 1.1 * px)));
  PUDDLES.forEach(([ux, uz, ur]) => {
    for (let i = 0; i < 7; i += 1) {
      const x = P(ux + (rand() - 0.5) * ur * 1.2);
      const y = P(uz + (rand() - 0.5) * ur * 0.6);
      const r = ur * (0.35 + rand() * 0.5) * px;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(96,96,96,0.9)');
      g.addColorStop(0.5, 'rgba(96,96,96,0.6)');
      g.addColorStop(1, 'rgba(96,96,96,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  });
}

// Normal map do grão do asfalto (ruído suavizado, repetido pelo piso)
function asphaltNormalCanvas(rand) {
  const n = 256;
  const raw = new Float32Array(n * n);
  for (let i = 0; i < raw.length; i += 1) raw[i] = rand();
  const at = (x, y) => raw[((y + n) % n) * n + ((x + n) % n)];
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += at(x + dx, y + dy);
      height[y * n + x] = sum / 9;
    }
  }
  const h = (x, y) => height[((y + n) % n) * n + ((x + n) % n)];
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 3;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 3;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      img.data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------- Cena ----------

// A casca: cria o renderizador e devolve já o `stop`; a montagem em si
// (buildScene) roda em etapas, pra não travar a página enquanto as texturas
// são pintadas - é nessa hora que a pessoa está digitando o email.
function startScene(THREE, libs, mount, options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const disposables = [];
  const track = (obj) => { disposables.push(obj); return obj; };
  const state = { stopped: false, cleanup: [] };
  const ready = buildScene(THREE, libs, mount, options, { renderer, track, state });
  const stop = () => {
    state.stopped = true;
    state.cleanup.forEach((fn) => fn());
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { stop, ready };
}

async function buildScene(THREE, { mergeGeometries }, mount, { animated }, { renderer, track, state }) {
  // Fim de etapa: devolve o controle pro navegador e espera a placa de vídeo
  // terminar o que ficou na fila (envio de texturas) - sem segurar a página:
  // a "cerca" (fence) é consultada de tempos em tempos, não aguardada.
  // Devolve `true` se a cena foi desmontada no meio.
  const gl = renderer.getContext();
  const interrupted = async () => {
    const fence = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    for (let i = 0; i < 500; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, i ? 8 : 0); });
      if (state.stopped || !fence) break;
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status !== gl.TIMEOUT_EXPIRED) break;
    }
    if (fence) gl.deleteSync(fence);
    return state.stopped;
  };
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  mount.appendChild(renderer.domElement);

  const rand = seeded(20261004);
  const parts = createParts(THREE, { track, mergeGeometries });
  const { standard, canvasTexture } = parts;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Manda a textura pra placa de vídeo já (senão vai tudo junto no 1º quadro)
  const upload = (...textures) => textures.forEach((texture) => { if (texture) renderer.initTexture(texture); });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6c2ab, 34, 430); // névoa quente de fim de tarde

  // ----- Céu: é o fundo, ilumina por reflexo e dá a cor do ambiente -----
  // Sol baixo vindo da direita, um pouco de frente: bate em cheio nas
  // testeiras, passa rasante pelas laterais corrugadas (realça o relevo) e
  // estica as sombras do guindaste e do caminhão ao longo da faixa
  const SUN = new THREE.Vector3(28, 11, 5).normalize();
  const sky = canvasTexture(2048, 1024, (ctx, w, h) => paintSky(ctx, w, h, {
    sunU: skyU(SUN.x, SUN.z), sunElevation: Math.asin(SUN.y), rand,
  }));
  if (await interrupted()) return;
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.anisotropy = maxAniso;
  upload(sky);
  // Cúpula com a textura aplicada direto (o fundo padrão converte em cubo e
  // deixa uma grade visível); o espelhamento do UV casa com o mapa de reflexos
  const domeGeometry = track(new THREE.SphereGeometry(1800, 48, 24));
  const domeUv = domeGeometry.attributes.uv;
  for (let i = 0; i < domeUv.count; i += 1) domeUv.setX(i, 1 - domeUv.getX(i));
  scene.add(new THREE.Mesh(domeGeometry, track(new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false }))));
  // Reflexos: saem de uma cópia pequena do céu (reflexo é borrado mesmo, e
  // pequeno prepara mais rápido), sem segurar a página - ver environment.js
  const skySmall = canvasTexture(512, 256, (ctx, w, h) => ctx.drawImage(sky.image, 0, 0, w, h));
  skySmall.mapping = THREE.EquirectangularReflectionMapping;
  const environment = await prefilterEnvironment(THREE, renderer, skySmall, () => state.stopped);
  if (environment) track(environment);
  if (state.stopped || !environment) return;
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.75;

  if (await interrupted()) return;

  scene.add(new THREE.HemisphereLight(0xc4dcea, 0x5a4b3e, 0.4));
  const sun = new THREE.DirectionalLight(0xffd3a0, 3.8);
  sun.position.copy(SUN).multiplyScalar(70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -27;
  sun.shadow.camera.right = 27;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5;
  scene.add(sun);

  // ----- Piso: trecho detalhado em volta do pátio + pano liso até a névoa -----
  const groundMap = canvasTexture(2048, 2048, (ctx, size) => paintGround(ctx, size, { rand }));
  groundMap.anisotropy = maxAniso;
  upload(groundMap);
  if (await interrupted()) return;
  const groundRoughness = canvasTexture(1024, 1024, (ctx, size) => paintRoughness(ctx, size, { rand }), { srgb: false });
  const grain = track(new THREE.CanvasTexture(asphaltNormalCanvas(rand)));
  grain.wrapS = THREE.RepeatWrapping;
  grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(70, 70);
  upload(groundRoughness, grain);
  if (await interrupted()) return;
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(GROUND, GROUND)),
    track(new THREE.MeshStandardMaterial({
      map: groundMap, roughnessMap: groundRoughness, roughness: 1, metalness: 0,
      normalMap: grain, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true,
    })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(
    track(new THREE.PlaneGeometry(2600, 800)),
    standard({ color: 0x4b4e50, roughness: 0.96, metalness: 0 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.04, QUAY_Z + 400);
  apron.receiveShadow = true;
  scene.add(apron);

  // ----- Contêineres -----
  const containerKit = createContainerKit(THREE, { mergeGeometries, track, rand, maxAniso });
  const { bodyGeo, frameGeo } = containerKit;
  const containerLook = (colorIndex) => containerKit.look(PALETTE[colorIndex], WORDMARKS[colorIndex]);
  // As pinturas (texturas de cada cor) uma por vez
  for (let i = 0; i < PALETTE.length; i += 1) {
    const look = containerLook(i);
    [...look[20], ...look[40]].forEach((material) => upload(material.map, material.normalMap));
    if (await interrupted()) return;
  }

  const yard = new THREE.Group();
  scene.add(yard);

  const makeContainer = (size, colorIndex) => {
    const look = containerLook(colorIndex);
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo[size], look[size]);
    const frame = new THREE.Mesh(frameGeo[size], look.frame);
    [body, frame].forEach((m) => { m.castShadow = true; m.receiveShadow = true; group.add(m); });
    group.userData = { body, frame, size };
    return group;
  };
  const paintContainer = (container, colorIndex) => {
    const look = containerLook(colorIndex);
    container.userData.body.material = look[container.userData.size];
    container.userData.frame.material = look.frame;
  };

  // Os contêineres parados são instanciados: uma malha por cor e tamanho,
  // não uma por contêiner. Só o que o guindaste carrega é um objeto à parte.
  const nearSlots = { 20: PALETTE.map(() => []), 40: PALETTE.map(() => []) };

  // Pilha onde o guindaste trabalha: fileira da frente, com 2 de altura
  const WORK = { bay: 4, row: ROWS - 1, tiers: 2 };
  const FRONT_ROW = [{ bay: 0, size: 40, tiers: 2 }, { bay: 2, size: 20, tiers: 3 }, { bay: 3, size: 20, tiers: 1 }, { bay: 4, size: 20, tiers: WORK.tiers }, { bay: 5, size: 20, tiers: 3 }];
  for (let row = 0; row < ROWS; row += 1) {
    const segments = [];
    if (row === ROWS - 1) {
      segments.push(...FRONT_ROW);
    } else {
      for (let bay = 0; bay < BAYS;) {
        const is40 = bay < BAYS - 1 && rand() < 0.45;
        // Fileiras do fundo mais altas: dá profundidade e não esconde a frente
        const tiers = Math.max(1, Math.min(4, Math.round(1.4 + rand() * 2.2 + (row < 2 ? 0.7 : 0))));
        segments.push({ bay, size: is40 ? 40 : 20, tiers });
        bay += is40 ? 2 : 1;
      }
    }
    segments.forEach(({ bay, size, tiers }) => {
      const x = size === 40 ? (slotX(bay) + slotX(bay + 1)) / 2 : slotX(bay);
      for (let tier = 0; tier < tiers; tier += 1) {
        nearSlots[size][Math.floor(rand() * PALETTE.length)].push([
          x + (rand() - 0.5) * 0.03, tierY(tier), rowZ(row) + (rand() - 0.5) * 0.03,
          rand() < 0.5 ? Math.PI : 0, // portas pra um lado ou pro outro
        ]);
      }
    });
  }

  // As outras quadras: só as pilhas, sem a moldura (de longe não se vê)
  const farSlots = PALETTE.map(() => []);
  [...BLOCKS.filter((block) => !block.main), ...FAR_BLOCKS].forEach((block) => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let bay = 0; bay < BAYS; bay += 1) {
        const tiers = Math.max(1, Math.min(4, Math.round(1.1 + rand() * 3.1)));
        // Muitas pilhas são de um armador só
        const stackColor = rand() < 0.4 ? Math.floor(rand() * PALETTE.length) : -1;
        for (let tier = 0; tier < tiers; tier += 1) {
          const colorIndex = stackColor >= 0 ? stackColor : Math.floor(rand() * PALETTE.length);
          farSlots[colorIndex].push([
            block.x + slotX(bay) + (rand() - 0.5) * 0.03, tierY(tier), block.z + rowZ(row) + (rand() - 0.5) * 0.03,
            rand() < 0.5 ? Math.PI : 0,
          ]);
        }
      }
    }
  });
  const dummy = new THREE.Object3D();
  const instanced = (geometry, material, slots) => {
    if (!slots.length) return;
    const mesh = track(new THREE.InstancedMesh(geometry, material, slots.length));
    slots.forEach(([x, y, z, turn], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, turn, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    yard.add(mesh);
  };
  PALETTE.forEach((color, colorIndex) => {
    const look = containerLook(colorIndex);
    [20, 40].forEach((size) => {
      instanced(bodyGeo[size], look[size], nearSlots[size][colorIndex]);
      instanced(frameGeo[size], look.frame, nearSlots[size][colorIndex]);
    });
    instanced(bodyGeo[20], look[20], farSlots[colorIndex]);
  });

  if (await interrupted()) return;

  // ----- Guindastes de pórtico: o da animação e dois parados em outras quadras -----
  const craneMaterials = rtgMaterials(parts, rand);
  const craneDims = (block, number) => ({
    legX: 2.15, zBack: block.z + Z_BACK, zFront: block.z + Z_FRONT, len20: LEN20, width: WIDTH, number,
  });
  const rtg = buildRtg(parts, craneMaterials, craneDims({ z: 0 }, '07'));
  yard.add(rtg.gantry);
  [[{ x: 0, z: -2 * PITCH_Z }, '04', 3.4], [{ x: -PITCH_X, z: -PITCH_Z }, '11', -PITCH_X - 3.5]].forEach(([block, number, x]) => {
    const parked = buildRtg(parts, craneMaterials, craneDims(block, number));
    parked.gantry.position.x = x;
    parked.setHook(block.z + rowZ(1), tierY(4) + HEIGHT / 2 + 1.3);
    yard.add(parked.gantry);
  });

  if (await interrupted()) return;

  // ----- Caminhão (cavalo + carreta porta-contêiner) -----
  const DECK_Y = 0.66;
  const truck = buildTruck(parts, truckMaterials(parts, rand), { width: WIDTH, deckY: DECK_Y });
  truck.group.position.z = LANE_Z;
  yard.add(truck.group);

  if (await interrupted()) return;

  // ----- Fundo: postes, cais, navio e guindastes de cais -----
  buildPort(parts, {
    parent: scene,
    rand,
    palette: PALETTE,
    quayZ: QUAY_Z,
    // A câmera olha pra -x/-z: é lá, ao longo do cais, que os navios aparecem
    ships: [-95, -215],
    // Um poste em cada esquina de quadra, fora da pista do pórtico
    masts: [-1.5, -0.5, 0.5].flatMap((i) => [0, -1, -2].map((j) => [i * PITCH_X - 1.9, j * PITCH_Z + Z_BACK - 0.95])),
  });

  if (await interrupted()) return;

  // ----- Coreografia -----
  // O contêiner de trabalho sai da pilha, vai pro caminhão, o caminhão leva
  // embora; chega outro caminhão com outro contêiner (outra cor) e o
  // guindaste põe na pilha. Um ciclo = CYCLE segundos.
  const CYCLE = 40;
  const STACK = new THREE.Vector3(slotX(WORK.bay), tierY(WORK.tiers), rowZ(WORK.row));
  const TRUCK_X = slotX(2);
  const ON_TRUCK = new THREE.Vector3(TRUCK_X - 0.05, DECK_Y + HEIGHT / 2, LANE_Z);
  const CRUISE_Y = tierY(4) + 0.28; // passa por cima de pilha de 4
  const FAR = 56;
  const COLOR_SEQUENCE = [3, 1, 6, 0, 2, 9, 5, 7];
  const cargo = makeContainer(20, COLOR_SEQUENCE[0]);
  yard.add(cargo);
  let cargoColor = COLOR_SEQUENCE[0];

  const update = (time) => {
    const cycle = Math.floor(time / CYCLE);
    const t = time - cycle * CYCLE;
    // Posição do "gancho" = centro de um contêiner preso no spreader
    let y;
    let mix;
    if (t < 13) {
      y = STACK.y + (CRUISE_Y - STACK.y) * ramp(t, 1, 4) - (CRUISE_Y - ON_TRUCK.y) * ramp(t, 9, 12);
      mix = ramp(t, 4, 9);
    } else if (t < 27) {
      y = ON_TRUCK.y + (CRUISE_Y - ON_TRUCK.y) * ramp(t, 13, 15.5) - (CRUISE_Y - ON_TRUCK.y) * ramp(t, 24, 26.5);
      mix = 1;
    } else {
      y = ON_TRUCK.y + (CRUISE_Y - ON_TRUCK.y) * ramp(t, 27, 30) - (CRUISE_Y - STACK.y) * ramp(t, 35, 38);
      mix = 1 - ramp(t, 30, 35);
    }
    const hookX = STACK.x + (ON_TRUCK.x - STACK.x) * mix;
    const hookZ = STACK.z + (ON_TRUCK.z - STACK.z) * mix;

    // Caminhão: carregado sai (acelera), outro chega (freia)
    let truckX = TRUCK_X;
    if (t >= 13.4 && t < 18.6) {
      const p = clamp01((t - 13.4) / 5.2);
      truckX = TRUCK_X + FAR * p * p;
    } else if (t >= 18.6 && t < 24) {
      const p = clamp01((t - 18.9) / 5.1);
      truckX = TRUCK_X - FAR * (1 - p) * (1 - p);
    }
    truck.group.position.x = truckX;
    truck.wheels.forEach((w) => { w.rotation.z = -truckX / truck.wheelRadius; });

    // Fora de vista o contêiner "vira outro": troca a cor
    const colorIndex = COLOR_SEQUENCE[(cycle + (t >= 18.75 ? 1 : 0)) % COLOR_SEQUENCE.length];
    if (colorIndex !== cargoColor) { cargoColor = colorIndex; paintContainer(cargo, colorIndex); }

    const hooked = t < 12.6 || t >= 27;
    if (hooked) cargo.position.set(hookX, y, hookZ);
    else cargo.position.set(truckX - 0.05, ON_TRUCK.y, LANE_Z);

    rtg.gantry.position.x = hookX;
    rtg.setHook(hookZ, y + HEIGHT / 2 + 0.085);
    rtg.beaconMaterial.emissiveIntensity = 1.2 + (Math.sin(time * 7) > 0.2 ? 2.4 : 0);
  };

  // ----- Câmera: baixa, na altura de um prédio, com o horizonte no quadro;
  // entrada com aproximação, órbita lenta e leve parallax -----
  const target = new THREE.Vector3(-1.2, 3.0, 2.8);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2400);
  const RADIUS = 40;
  const CAM_HEIGHT = 7.2;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointerMove = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  const placeCamera = (time, intro) => {
    const angle = 0.76 + Math.sin(time * 0.1) * 0.26 + pointer.x * 0.08;
    const radius = RADIUS + intro * 14;
    camera.position.set(
      target.x + Math.sin(angle) * radius,
      CAM_HEIGHT + intro * 5 - pointer.y * 1.0,
      target.z + Math.cos(angle) * radius,
    );
    camera.lookAt(target);
  };

  const resize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Painel estreito/alto: abre o campo de visão pra o pátio caber inteiro
    camera.fov = w / h < 0.95 ? 37 : 31;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  let frames = 0;
  let slowTime = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (document.hidden) { clock.getDelta(); return; }
    const delta = Math.min(clock.getDelta(), 0.1);
    const time = clock.elapsedTime;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    update(time + 2);
    placeCamera(time, 1 - smooth(clamp01(time / 2.2)));
    renderer.render(scene, camera);

    // Máquina fraca: depois de 2 s, se a média passar de ~33 ms por quadro,
    // baixa a resolução e, se ainda assim não der, desliga as sombras
    frames += 1;
    if (time > 2 && frames < 400) {
      slowTime += delta;
      if (frames % 60 === 0) {
        if (slowTime / 60 > 0.033) {
          if (pixelRatio > 1) {
            pixelRatio = 1;
            renderer.setPixelRatio(1);
            resize();
          } else if (renderer.shadowMap.enabled) {
            renderer.shadowMap.enabled = false;
            sun.castShadow = false;
            scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
          }
        }
        slowTime = 0;
      }
    }
  };
  state.cleanup.push(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
  });
  // Compila os shaders em segundo plano (sem travar a tela) e só então
  // desenha; a função termina depois do primeiro quadro, que é quando o
  // painel faz o fade de entrada.
  update(2);
  placeCamera(0, animated ? 1 : 0);
  await (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).catch(() => {});
  if (state.stopped) return;
  if (animated) {
    clock.start();
    loop();
  } else {
    // "Reduzir movimento": um único quadro, com o contêiner no ar
    update(8);
    placeCamera(0, 0);
    renderer.render(scene, camera);
  }
}

export default function LoginScene3D({ className = '' }) {
  const mountRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    const media = window.matchMedia(DESKTOP_QUERY);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    let stop = null;
    let loading = false;

    const start = () => {
      if (stop || loading || cancelled || !media.matches) return;
      loading = true;
      Promise.all([
        import('three'),
        import('three/examples/jsm/utils/BufferGeometryUtils.js'),
      ])
        .then(([THREE, { mergeGeometries }]) => {
          loading = false;
          if (cancelled || stop || !mount) return;
          const sceneHandle = startScene(THREE, { mergeGeometries }, mount, { animated: !reduceMotion });
          stop = sceneHandle.stop;
          sceneHandle.ready
            .then(() => { if (!cancelled) setReady(true); })
            .catch(() => { if (stop) stop(); stop = null; });
        })
        .catch(() => { loading = false; /* sem WebGL/3D: fica só o fundo em degradê */ });
    };

    // Monta a cena só depois que o formulário terminou de entrar: gerar as
    // texturas ocupa a CPU por um instante e travaria essa animação
    const timer = setTimeout(start, 650);
    media.addEventListener('change', start);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      media.removeEventListener('change', start);
      if (stop) stop();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className={`absolute inset-0 transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}
