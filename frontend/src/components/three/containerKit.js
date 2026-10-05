// Contêiner ISO em three.js, todo procedural (nada de arquivo externo): as
// texturas (chapa corrugada, marcações, desgaste) são desenhadas em canvas e
// o relevo da chapa vem de um normal map. Usado pela cena da tela de login
// (LoginScene3D.jsx) e pelo mini-pátio do Dashboard (three/yardScene.js).

// 1 unidade = 2 m. Contêiner ISO: 6,06 / 12,19 m de comprimento, 2,59 de
// altura, 2,44 de largura.
export const LEN20 = 3.03;
export const LEN40 = 6.095;
export const HEIGHT = 1.295;
export const WIDTH = 1.22;

// Pseudoaleatório com semente fixa: a cena sai sempre igual
export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const channels = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const luminance = (hex) => { const [r, g, b] = channels(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
export const mixHex = (hex, target, k) => {
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

// ---------- Geometria e materiais ----------

/**
 * Prepara geometria e materiais dos contêineres de uma cena. `track` recebe
 * tudo que precisa de dispose() no fim; `rand` é o pseudoaleatório da cena
 * (desgaste e números de série). `look(cor, texto)` devolve os materiais de
 * uma pintura: { 20: [...6 faces], 40: [...6 faces], frame }.
 */
export function createContainerKit(THREE, { mergeGeometries, track, rand, maxAniso = 1 }) {
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

  const looks = new Map();
  const look = (color, word) => {
    const key = `${color}|${word}`;
    if (looks.has(key)) return looks.get(key);
    const code = () => `CLXU ${String(Math.floor(100000 + rand() * 899999))} ${Math.floor(rand() * 10)}`;
    const normalScale = new THREE.Vector2(0.9, 0.9);
    const side20 = standard({ map: canvasTexture(512, 256, (ctx, w, h) => paintSide(ctx, w, h, { color, rand, ribs: 26, is40: false, word, code: code() })), normalMap: ribNormal(26), normalScale });
    const side40 = standard({ map: canvasTexture(1024, 256, (ctx, w, h) => paintSide(ctx, w, h, { color, rand, ribs: 52, is40: true, word, code: code() })), normalMap: ribNormal(52), normalScale });
    const door = standard({ map: canvasTexture(256, 256, (ctx, w, h) => paintDoor(ctx, w, h, { color, rand, code: code() })) });
    const end = standard({ map: canvasTexture(256, 256, (ctx, w, h) => paintEnd(ctx, w, h, { color, rand, code: code() })), normalMap: ribNormal(9), normalScale });
    const roofColor = mixHex(color, 0xffffff, 0.1);
    const top20 = standard({ color: roofColor, normalMap: ribNormal(22), normalScale, roughness: 0.78 });
    const top40 = standard({ color: roofColor, normalMap: ribNormal(44), normalScale, roughness: 0.78 });
    const made = {
      // Ordem das faces do BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
      20: [door, end, top20, underside, side20, side20],
      40: [door, end, top40, underside, side40, side40],
      frame: standard({ color: mixHex(color, 0x000000, 0.24), roughness: 0.68, metalness: 0.32 }),
    };
    looks.set(key, made);
    return made;
  };

  return { bodyGeo, frameGeo, look };
}
