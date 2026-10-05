import { useEffect, useRef, useState } from 'react';

// Cena 3D da tela de login: um bloco de pátio com contêineres de 20' e 40'
// empilhados, um guindaste de pórtico (RTG) que tira um contêiner da pilha e
// carrega um caminhão, o caminhão que sai e outro que chega pra descarregar,
// tudo visto por uma câmera que orbita devagar e acompanha o mouse.
//
// O three.js é carregado sob demanda (import dinâmico), então só pesa nesta
// tela - e só em telas largas, onde o painel aparece. Sem WebGL fica o fundo
// em degradê; com "reduzir movimento" ligado, um único quadro parado.
// Nada aqui usa arquivo externo: texturas (chapa corrugada, marcações,
// desgaste, asfalto) são desenhadas em canvas na hora.

const DESKTOP_QUERY = '(min-width: 1024px)';

// 1 unidade = 2 m. Contêiner ISO: 6,06 / 12,19 m de comprimento, 2,59 de
// altura, 2,44 de largura.
const LEN20 = 3.03;
const LEN40 = 6.095;
const HEIGHT = 1.295;
const WIDTH = 1.22;
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
const BLOCK_DEPTH = ROWS * ROW;
const LANE_Z = BLOCK_DEPTH / 2 + 1.25; // faixa do caminhão, na frente do bloco

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ramp = (t, a, b) => smooth(clamp01((t - a) / (b - a)));

// Pseudoaleatório com semente fixa: a cena sai sempre igual
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const channels = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const luminance = (hex) => { const [r, g, b] = channels(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const mixHex = (hex, target, k) => {
  const [r, g, b] = channels(hex);
  const [tr, tg, tb] = channels(target);
  return (Math.round(r + (tr - r) * k) << 16) | (Math.round(g + (tg - g) * k) << 8) | Math.round(b + (tb - b) * k);
};

// ---------- Texturas desenhadas em canvas ----------

function weathering(ctx, w, h, rand, amount) {
  // Desbotado em cima, sujeira embaixo
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.25, 'rgba(255,255,255,0)');
  g.addColorStop(0.76, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(30,22,14,0.32)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Escorridos de chuva
  for (let i = 0; i < amount * 7; i += 1) {
    const x = rand() * w;
    const y = rand() * h * 0.35;
    const len = h * (0.15 + rand() * 0.6);
    const sg = ctx.createLinearGradient(0, y, 0, y + len);
    sg.addColorStop(0, `rgba(25,18,12,${0.03 + rand() * 0.07})`);
    sg.addColorStop(1, 'rgba(25,18,12,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(x, y, 1 + rand() * 3, len);
  }
  // Pontos de ferrugem, mais perto da base
  for (let i = 0; i < amount; i += 1) {
    const x = rand() * w;
    const y = h * (0.5 + rand() * 0.5);
    const r = 3 + rand() * 10;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(122,58,22,0.55)');
    rg.addColorStop(1, 'rgba(122,58,22,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

function ribShading(ctx, w, h, ribs) {
  // Só um reforço de luz/sombra; o relevo de verdade vem do normal map
  const bw = w / ribs;
  for (let i = 0; i < ribs; i += 1) {
    const g = ctx.createLinearGradient(i * bw, 0, (i + 1) * bw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.10)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(i * bw, 0, bw + 1, h);
  }
}

function paintSide(ctx, w, h, { color, rand, ribs, is40, word, code }) {
  ctx.fillStyle = hexCss(color);
  ctx.fillRect(0, 0, w, h);
  ribShading(ctx, w, h, ribs);
  weathering(ctx, w, h, rand, is40 ? 10 : 5);
  const ink = luminance(color) > 0.6 ? 'rgba(24,32,44,0.88)' : 'rgba(245,247,250,0.92)';
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const big = Math.round(h * (word.length > 8 ? 0.2 : 0.34));
  ctx.font = `900 ${big}px "Arial Black", Impact, Arial, sans-serif`;
  ctx.fillText(word, w * 0.06, h * 0.48);
  ctx.textAlign = 'right';
  ctx.font = `700 ${Math.round(h * 0.105)}px Arial, sans-serif`;
  ctx.fillText(code, w * 0.968, h * 0.16);
  ctx.fillText(is40 ? '42G1' : '22G1', w * 0.968, h * 0.29);
  ctx.font = `600 ${Math.round(h * 0.05)}px Arial, sans-serif`;
  ['MAX GROSS 30.480 KG', 'TARE 2.230 KG', 'NET 28.250 KG', 'CU.CAP. 33,2 CU.M']
    .forEach((line, i) => ctx.fillText(line, w * 0.968, h * (0.56 + i * 0.075)));
  // Longarinas de cima e de baixo
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, w, h * 0.035);
  ctx.fillRect(0, h * 0.965, w, h * 0.035);
}

function paintEnd(ctx, w, h, { color, rand, code }) {
  ctx.fillStyle = hexCss(color);
  ctx.fillRect(0, 0, w, h);
  ribShading(ctx, w, h, 9);
  weathering(ctx, w, h, rand, 3);
  ctx.fillStyle = luminance(color) > 0.6 ? 'rgba(24,32,44,0.85)' : 'rgba(245,247,250,0.9)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.07)}px Arial, sans-serif`;
  ctx.fillText(code, w * 0.94, h * 0.13);
}

function paintDoor(ctx, w, h, { color, rand, code }) {
  ctx.fillStyle = hexCss(color);
  ctx.fillRect(0, 0, w, h);
  // Painéis das duas folhas (frisos horizontais)
  for (let i = 1; i < 6; i += 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fillRect(w * 0.03, h * (i / 6) - 1, w * 0.94, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(w * 0.03, h * (i / 6) + 1, w * 0.94, 1);
  }
  weathering(ctx, w, h, rand, 4);
  // Encontro das folhas e borrachas
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(w * 0.494, 0, w * 0.012, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = w * 0.02;
  ctx.strokeRect(w * 0.01, h * 0.01, w * 0.98, h * 0.98);
  // Barras de travamento (aço galvanizado) com manoplas
  [0.16, 0.38, 0.62, 0.84].forEach((x) => {
    const bx = w * x;
    const g = ctx.createLinearGradient(bx - 3, 0, bx + 4, 0);
    g.addColorStop(0, '#8b949c');
    g.addColorStop(0.45, '#e3e7ea');
    g.addColorStop(1, '#6d757c');
    ctx.fillStyle = g;
    ctx.fillRect(bx - 3, h * 0.035, 7, h * 0.93);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(bx + 4, h * 0.035, 2, h * 0.93);
    ctx.fillStyle = '#b9c0c6';
    ctx.fillRect(bx - 16, h * 0.53, 30, 5);
    ctx.fillStyle = '#5f676e';
    [0.06, 0.94].forEach((y) => ctx.fillRect(bx - 6, h * y - 4, 13, 8));
  });
  // Dobradiças
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  [0.14, 0.38, 0.62, 0.86].forEach((y) => {
    ctx.fillRect(w * 0.012, h * y - 5, 9, 10);
    ctx.fillRect(w * 0.988 - 9, h * y - 5, 9, 10);
  });
  // Código na folha direita e placa CSC na esquerda
  ctx.fillStyle = luminance(color) > 0.6 ? 'rgba(24,32,44,0.88)' : 'rgba(245,247,250,0.92)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.062)}px Arial, sans-serif`;
  ctx.fillText(code, w * 0.955, h * 0.12);
  ctx.fillText('22G1', w * 0.955, h * 0.2);
  ctx.fillStyle = 'rgba(40,46,52,0.85)';
  ctx.fillRect(w * 0.2, h * 0.7, w * 0.15, h * 0.1);
  ctx.fillStyle = 'rgba(230,234,238,0.7)';
  for (let i = 0; i < 4; i += 1) ctx.fillRect(w * 0.21, h * (0.715 + i * 0.02), w * 0.13, 1.5);
}

function paintGround(ctx, size, { rand, pxPerUnit }) {
  const c = size / 2;
  ctx.fillStyle = '#1b2a2a';
  ctx.fillRect(0, 0, size, size);
  // Granulado do asfalto
  for (let i = 0; i < 26000; i += 1) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.015 + rand() * 0.05})` : `rgba(0,0,0,${0.04 + rand() * 0.1})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  // Manchas (óleo, remendos)
  for (let i = 0; i < 40; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 8 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.06 + rand() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const X = (u) => c + u * pxPerUnit;
  const Z = (u) => c + u * pxPerUnit;
  // Marcas de pneu na faixa do caminhão
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  [-0.47, 0.47].forEach((dz) => ctx.fillRect(0, Z(LANE_Z + dz) - 3, size, 6));
  // Vagas pintadas (amarelo gasto) debaixo do bloco
  ctx.strokeStyle = 'rgba(232,190,46,0.55)';
  ctx.lineWidth = 2;
  for (let bay = 0; bay < BAYS; bay += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      ctx.strokeRect(X(slotX(bay) - LEN20 / 2 - 0.02), Z(rowZ(row) - WIDTH / 2 - 0.05), (LEN20 + 0.04) * pxPerUnit, (WIDTH + 0.1) * pxPerUnit);
    }
  }
  // Faixa do caminhão: bordas contínuas e eixo tracejado
  ctx.fillStyle = 'rgba(236,240,241,0.6)';
  [-0.9, 0.9].forEach((dz) => ctx.fillRect(0, Z(LANE_Z + dz) - 1.5, size, 3));
  ctx.fillStyle = 'rgba(232,190,46,0.5)';
  for (let x = 0; x < size; x += 46) ctx.fillRect(x, Z(LANE_Z + 1.9) - 1.5, 26, 3);
  // Trilho de rodagem do pórtico
  ctx.fillStyle = 'rgba(232,190,46,0.28)';
  [-(BLOCK_DEPTH / 2 + 0.8), LANE_Z + 1.25].forEach((z) => ctx.fillRect(0, Z(z) - 7, size, 14));
  // Some pras bordas: o degradê do painel aparece em volta
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(c, c, size * 0.2, c, c, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
}

// Normal map de uma onda da chapa corrugada (perfil trapezoidal); cada
// material repete quantas ondas precisar
function ribNormalCanvas() {
  const w = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, 4);
  const profile = (u) => {
    const p = u - Math.floor(u);
    if (p < 0.2) return 0;
    if (p < 0.35) return (p - 0.2) / 0.15;
    if (p < 0.65) return 1;
    if (p < 0.8) return 1 - (p - 0.65) / 0.15;
    return 0;
  };
  for (let x = 0; x < w; x += 1) {
    const slope = ((profile((x + 1) / w) - profile((x - 1) / w)) / 2) * 7;
    const len = Math.hypot(slope, 1);
    for (let y = 0; y < 4; y += 1) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((-slope / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = 128;
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------- Cena ----------

function startScene(THREE, { RoomEnvironment, mergeGeometries }, mount, { animated }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  mount.appendChild(renderer.domElement);

  const disposables = [];
  const track = (obj) => { disposables.push(obj); return obj; };
  const rand = seeded(20261004);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x063d38, 40, 100);

  // Reflexos suaves de ambiente (tinta e vidro deixam de parecer plástico)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = track(pmrem.fromScene(new RoomEnvironment(), 0.04));
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xcfeeff, 0x0c2f2b, 0.6));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-13, 24, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -19;
  sun.shadow.camera.right = 19;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const canvasTexture = (w, h, paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paint(canvas.getContext('2d'), w, h);
    const texture = track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAniso;
    return texture;
  };
  const ribCanvas = ribNormalCanvas();
  const ribNormal = (repeat) => {
    const texture = track(new THREE.CanvasTexture(ribCanvas));
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, 1);
    return texture;
  };
  const standard = (opts) => track(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, ...opts }));

  // Peças simples: uma caixa e um cilindro unitários, escalados por malha
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const unitWheel = track(new THREE.CylinderGeometry(1, 1, 1, 22));
  unitWheel.rotateX(Math.PI / 2); // eixo no Z: roda rola ao longo do X
  const box = (parent, material, sx, sy, sz, x, y, z) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ----- Chão -----
  const GROUND = 90;
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(GROUND, GROUND)),
    standard({
      map: canvasTexture(1024, 1024, (ctx, size) => paintGround(ctx, size, { rand, pxPerUnit: size / GROUND })),
      transparent: true, roughness: 0.95, metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ----- Contêineres -----
  const bodyGeo = { 20: track(new THREE.BoxGeometry(LEN20, HEIGHT, WIDTH)), 40: track(new THREE.BoxGeometry(LEN40, HEIGHT, WIDTH)) };
  // Estrutura: colunas de canto, longarinas e cantoneiras, um tico pra fora da chapa
  const frameGeometry = (len) => {
    const parts = [];
    const add = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); parts.push(g); };
    const t = 0.055;
    const o = 0.005;
    const hx = len / 2;
    const hy = HEIGHT / 2;
    const hz = WIDTH / 2;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => add(t, HEIGHT, t, sx * (hx - t / 2 + o), 0, sz * (hz - t / 2 + o))));
    [-1, 1].forEach((sy) => [-1, 1].forEach((sz) => add(len, t * 0.9, t * 0.7, 0, sy * (hy - t * 0.45 + o), sz * (hz - t * 0.35 + o))));
    [-1, 1].forEach((sy) => [-1, 1].forEach((sx) => add(t * 0.7, t * 0.9, WIDTH, sx * (hx - t * 0.35 + o), sy * (hy - t * 0.45 + o), 0)));
    const c = 0.09;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => [-1, 1].forEach((sz) => add(c, c * 0.72, c, sx * (hx - c / 2 + 0.014), sy * (hy - c * 0.36 + 0.014), sz * (hz - c / 2 + 0.014)))));
    const merged = track(mergeGeometries(parts));
    parts.forEach((g) => g.dispose());
    return merged;
  };
  const frameGeo = { 20: frameGeometry(LEN20), 40: frameGeometry(LEN40) };
  const underside = standard({ color: 0x1a1d21, roughness: 0.9, metalness: 0.1 });

  const colorCache = new Map();
  const containerLook = (colorIndex) => {
    if (colorCache.has(colorIndex)) return colorCache.get(colorIndex);
    const color = PALETTE[colorIndex];
    const word = WORDMARKS[colorIndex];
    const code = () => `CLXU ${String(Math.floor(100000 + rand() * 899999))} ${Math.floor(rand() * 10)}`;
    const normalScale = new THREE.Vector2(0.9, 0.9);
    const side20 = standard({ map: canvasTexture(512, 256, (ctx, w, h) => paintSide(ctx, w, h, { color, rand, ribs: 26, is40: false, word, code: code() })), normalMap: ribNormal(26), normalScale });
    const side40 = standard({ map: canvasTexture(1024, 256, (ctx, w, h) => paintSide(ctx, w, h, { color, rand, ribs: 52, is40: true, word, code: code() })), normalMap: ribNormal(52), normalScale });
    const door = standard({ map: canvasTexture(256, 256, (ctx, w, h) => paintDoor(ctx, w, h, { color, rand, code: code() })) });
    const end = standard({ map: canvasTexture(256, 256, (ctx, w, h) => paintEnd(ctx, w, h, { color, rand, code: code() })), normalMap: ribNormal(9), normalScale });
    const roofColor = mixHex(color, 0xffffff, 0.1);
    const top20 = standard({ color: roofColor, normalMap: ribNormal(22), normalScale, roughness: 0.78 });
    const top40 = standard({ color: roofColor, normalMap: ribNormal(44), normalScale, roughness: 0.78 });
    const look = {
      // Ordem das faces do BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
      20: [door, end, top20, underside, side20, side20],
      40: [door, end, top40, underside, side40, side40],
      frame: standard({ color: mixHex(color, 0x000000, 0.24), roughness: 0.68, metalness: 0.32 }),
    };
    colorCache.set(colorIndex, look);
    return look;
  };

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
        const container = makeContainer(size, Math.floor(rand() * PALETTE.length));
        container.position.set(x + (rand() - 0.5) * 0.03, tierY(tier), rowZ(row) + (rand() - 0.5) * 0.03);
        if (rand() < 0.5) container.rotation.y = Math.PI; // portas pra um lado ou pro outro
        yard.add(container);
      }
    });
  }

  // ----- Guindaste de pórtico (RTG) -----
  const craneYellow = standard({ color: 0xf2b705, roughness: 0.5, metalness: 0.35 });
  const craneDark = standard({ color: 0x23282e, roughness: 0.6, metalness: 0.5 });
  const craneGray = standard({ color: 0xcfd6dc, roughness: 0.55, metalness: 0.35 });
  const glass = standard({ color: 0x0b1f2a, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.6 });
  const rubber = standard({ color: 0x111315, roughness: 0.92, metalness: 0 });
  const steel = standard({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.85 });

  const LEG_X = 2.15;
  const LEG_H = 7.95;
  const Z_BACK = -(BLOCK_DEPTH / 2 + 0.8);
  const Z_FRONT = LANE_Z + 1.25;
  const SPAN = Z_FRONT - Z_BACK;
  const Z_MID = (Z_FRONT + Z_BACK) / 2;
  const GIRDER_Y = LEG_H + 0.25;

  const gantry = new THREE.Group();
  yard.add(gantry);
  [Z_BACK, Z_FRONT].forEach((z) => {
    [-LEG_X, LEG_X].forEach((x) => {
      box(gantry, craneYellow, 0.3, LEG_H, 0.34, x, LEG_H / 2 + 0.55, z);
      // Truques com 2 rodas por perna
      [-0.42, 0.42].forEach((dx) => {
        const wheel = new THREE.Mesh(unitWheel, rubber);
        wheel.scale.set(0.34, 0.34, 0.26);
        wheel.position.set(x + dx, 0.34, z);
        wheel.castShadow = true;
        gantry.add(wheel);
      });
      box(gantry, craneDark, 1.25, 0.2, 0.42, x, 0.62, z);
    });
    box(gantry, craneYellow, LEG_X * 2 + 0.3, 0.34, 0.4, 0, 0.9, z); // viga de base
    box(gantry, craneYellow, LEG_X * 2 + 0.3, 0.42, 0.36, 0, GIRDER_Y, z); // travessa do topo
    box(gantry, craneDark, 0.9, 0.5, 0.5, 0, 1.3, z); // casa de máquinas/gerador
  });
  [-1.05, 1.05].forEach((x) => box(gantry, craneYellow, 0.36, 0.52, SPAN + 0.5, x, GIRDER_Y + 0.05, Z_MID)); // vigas principais
  [-1.05, 1.05].forEach((x) => box(gantry, craneDark, 0.1, 0.06, SPAN + 0.3, x, GIRDER_Y + 0.34, Z_MID)); // trilhos do carro

  const trolley = new THREE.Group();
  trolley.position.y = GIRDER_Y + 0.42;
  gantry.add(trolley);
  box(trolley, craneDark, 2.5, 0.16, 1.5, 0, 0, 0);
  box(trolley, craneGray, 1.5, 0.6, 1.05, -0.2, 0.38, 0);
  box(trolley, craneGray, 0.72, 0.8, 0.85, 1.55, -0.72, 0); // cabine do operador
  box(trolley, glass, 0.74, 0.42, 0.87, 1.56, -0.62, 0);
  box(trolley, craneDark, 0.1, 0.5, 0.1, 1.55, -0.2, 0);
  const beaconMaterial = track(new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9500, emissiveIntensity: 2, roughness: 0.4 }));
  const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 12, 8)), beaconMaterial);
  beacon.position.set(-0.2, 0.78, 0);
  trolley.add(beacon);

  // Spreader (quadro que pega o contêiner) e cabos de içamento
  const spreader = new THREE.Group();
  gantry.add(spreader);
  box(spreader, craneYellow, LEN20 * 0.99, 0.13, 0.5, 0, 0, 0);
  [-1, 1].forEach((s) => box(spreader, craneYellow, 0.16, 0.12, WIDTH * 0.99, s * LEN20 * 0.46, -0.02, 0));
  box(spreader, craneDark, 1.1, 0.26, 0.7, 0, 0.16, 0);
  const cableGeo = track(new THREE.CylinderGeometry(0.016, 0.016, 1, 6));
  cableGeo.translate(0, 0.5, 0); // base no spreader, cresce pra cima
  const cables = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const cable = new THREE.Mesh(cableGeo, steel);
    cable.position.set(sx * 0.42, 0.28, sz * 0.26);
    spreader.add(cable);
    return cable;
  });

  // ----- Caminhão (cavalo + carreta porta-contêiner) -----
  const truckPaint = standard({ color: 0xf4f6f8, roughness: 0.4, metalness: 0.35 });
  const truck = new THREE.Group();
  truck.position.z = LANE_Z;
  yard.add(truck);
  const DECK_Y = 0.66;
  box(truck, craneDark, LEN20 + 0.5, 0.12, WIDTH * 0.96, -0.05, DECK_Y - 0.06, 0); // plataforma
  [-0.36, 0.36].forEach((z) => box(truck, craneDark, LEN20 + 2.6, 0.14, 0.12, 1.0, DECK_Y - 0.22, z)); // longarinas
  box(truck, craneDark, 0.12, 0.2, WIDTH, -LEN20 / 2 - 0.3, DECK_Y - 0.2, 0); // para-choque
  box(truck, truckPaint, 1.05, 1.22, 1.18, LEN20 / 2 + 1.55, 1.2, 0); // cabine
  box(truck, glass, 0.06, 0.48, 1.06, LEN20 / 2 + 2.08, 1.48, 0); // para-brisa
  box(truck, glass, 0.5, 0.42, 1.2, LEN20 / 2 + 1.72, 1.5, 0); // janelas laterais
  box(truck, craneDark, 0.1, 0.34, 1.16, LEN20 / 2 + 2.1, 0.78, 0); // grade
  box(truck, craneDark, 0.9, 0.5, 0.86, LEN20 / 2 + 0.55, 0.78, 0); // quinta roda / tanques
  const lamp = track(new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b8, emissiveIntensity: 1.6 }));
  [-0.42, 0.42].forEach((z) => box(truck, lamp, 0.04, 0.1, 0.2, LEN20 / 2 + 2.16, 0.7, z));
  const wheels = [];
  [-LEN20 / 2 + 0.4, -LEN20 / 2 + 0.98, LEN20 / 2 + 0.5, LEN20 / 2 + 1.75].forEach((x) => {
    [-0.48, 0.48].forEach((z) => {
      const wheel = new THREE.Mesh(unitWheel, rubber);
      wheel.scale.set(0.27, 0.27, 0.22);
      wheel.position.set(x, 0.27, z);
      wheel.castShadow = true;
      truck.add(wheel);
      wheels.push(wheel);
      const hub = new THREE.Mesh(unitWheel, steel);
      hub.scale.set(0.12, 0.12, 0.235);
      hub.position.copy(wheel.position);
      truck.add(hub);
    });
  });

  // ----- Coreografia -----
  // O contêiner de trabalho sai da pilha, vai pro caminhão, o caminhão leva
  // embora; chega outro caminhão com outro contêiner (outra cor) e o
  // guindaste põe na pilha. Um ciclo = CYCLE segundos.
  const CYCLE = 40;
  const STACK = new THREE.Vector3(slotX(WORK.bay), tierY(WORK.tiers), rowZ(WORK.row));
  const TRUCK_X = slotX(2);
  const ON_TRUCK = new THREE.Vector3(TRUCK_X - 0.05, DECK_Y + HEIGHT / 2, LANE_Z);
  const CRUISE_Y = tierY(4) + 0.28; // passa por cima de pilha de 4
  const FAR = 52;
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
    truck.position.x = truckX;
    wheels.forEach((w) => { w.rotation.z = -truckX / 0.27; });

    // Fora de vista o contêiner "vira outro": troca a cor
    const colorIndex = COLOR_SEQUENCE[(cycle + (t >= 18.75 ? 1 : 0)) % COLOR_SEQUENCE.length];
    if (colorIndex !== cargoColor) { cargoColor = colorIndex; paintContainer(cargo, colorIndex); }

    const hooked = t < 12.6 || t >= 27;
    if (hooked) cargo.position.set(hookX, y, hookZ);
    else cargo.position.set(truckX - 0.05, ON_TRUCK.y, LANE_Z);

    gantry.position.x = hookX;
    trolley.position.z = hookZ;
    const spreaderY = y + HEIGHT / 2 + 0.085;
    spreader.position.set(0, spreaderY, hookZ);
    const cableLength = Math.max(0.05, trolley.position.y - 0.1 - (spreaderY + 0.28));
    cables.forEach((cable) => { cable.scale.y = cableLength; });
    beaconMaterial.emissiveIntensity = 1.2 + (Math.sin(time * 7) > 0.2 ? 2.4 : 0);
  };

  // ----- Câmera: entrada com aproximação, órbita lenta e leve parallax -----
  const target = new THREE.Vector3(0, -0.9, 1.0);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 220);
  const RADIUS = 41;
  const CAM_HEIGHT = 17;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointerMove = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  const placeCamera = (time, intro) => {
    const angle = 0.76 + Math.sin(time * 0.1) * 0.26 + pointer.x * 0.08;
    const radius = RADIUS + intro * 16;
    camera.position.set(
      target.x + Math.sin(angle) * radius,
      CAM_HEIGHT + intro * 8 - pointer.y * 1.4,
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
  // Compila os shaders em segundo plano (sem travar a tela) e só então
  // desenha; `ready` resolve depois do primeiro quadro, que é quando o
  // painel faz o fade de entrada.
  let stopped = false;
  update(2);
  placeCamera(0, animated ? 1 : 0);
  const compile = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve();
  const ready = compile.catch(() => {}).then(() => {
    if (stopped) return;
    if (animated) {
      clock.start();
      loop();
    } else {
      // "Reduzir movimento": um único quadro, com o contêiner no ar
      update(8);
      placeCamera(0, 0);
      renderer.render(scene, camera);
    }
  });

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { stop, ready };
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
        import('three/examples/jsm/environments/RoomEnvironment.js'),
        import('three/examples/jsm/utils/BufferGeometryUtils.js'),
      ])
        .then(([THREE, { RoomEnvironment }, { mergeGeometries }]) => {
          loading = false;
          if (cancelled || stop || !mount) return;
          const sceneHandle = startScene(THREE, { RoomEnvironment, mergeGeometries }, mount, { animated: !reduceMotion });
          stop = sceneHandle.stop;
          sceneHandle.ready.then(() => { if (!cancelled) setReady(true); });
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
