import { noiseTile } from './sceneParts';

// Cenário de fundo da cena de login: o céu de fim de tarde (pintado em canvas,
// serve de fundo e de fonte dos reflexos), os postes de iluminação do pátio e,
// lá atrás na névoa, o cais com um navio porta-contêiner atracado e os
// guindastes de cais (STS). Nada disso se mexe; dá escala e profundidade.

/** Posição horizontal (0 a 1) de uma direção na textura equirretangular. */
export const skyU = (x, z) => Math.atan2(z, x) / (2 * Math.PI) + 0.5;

/**
 * Céu de fim de tarde: degradê do azul-petróleo no alto ao pêssego no
 * horizonte, clarão quente do lado do sol, faixa rosada do lado oposto e
 * nuvens esticadas, iluminadas conforme a distância do sol.
 */
export function paintSky(ctx, w, h, { sunU, sunElevation, rand }) {
  const horizon = h / 2;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  // A câmera só enxerga os primeiros ~15° acima do horizonte: é ali que o
  // degradê precisa acontecer
  sky.addColorStop(0, '#173f5f');
  sky.addColorStop(0.55, '#2f6d8c');
  sky.addColorStop(0.8, '#5f9db3');
  sky.addColorStop(0.89, '#9cc3c6');
  sky.addColorStop(0.95, '#dccdb6');
  sky.addColorStop(1, '#f3c9a0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  // Abaixo do horizonte só aparece nos reflexos: tom do chão
  const below = ctx.createLinearGradient(0, horizon, 0, h);
  below.addColorStop(0, '#8a7d70');
  below.addColorStop(0.15, '#4b4845');
  below.addColorStop(1, '#2b2a29');
  ctx.fillStyle = below;
  ctx.fillRect(0, horizon, w, horizon);

  // Distância angular (0 a 0,5) de uma coluna até o sol, com a volta do círculo
  const fromSun = (u) => { const d = Math.abs(u - sunU) % 1; return Math.min(d, 1 - d); };
  const wrapped = (u, draw) => [-1, 0, 1].forEach((k) => draw((u + k) * w));
  const glowAt = (u, radius, squash, stops) => wrapped(u, (cx) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, horizon);
    ctx.clip();
    ctx.translate(cx, horizon);
    ctx.scale(1, squash);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    ctx.fillStyle = g;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  });
  glowAt(sunU, w * 0.34, 0.5, [[0, 'rgba(255,218,160,0.95)'], [0.3, 'rgba(255,190,125,0.5)'], [1, 'rgba(255,170,110,0)']]);
  glowAt(sunU + 0.5, w * 0.3, 0.22, [[0, 'rgba(226,168,176,0.55)'], [1, 'rgba(226,168,176,0)']]);

  // O sol (fora do quadro da câmera; ilumina os reflexos)
  const sunY = horizon - (sunElevation / (Math.PI / 2)) * horizon;
  wrapped(sunU, (cx) => {
    const g = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, w * 0.05);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.12, 'rgba(255,240,205,0.95)');
    g.addColorStop(0.4, 'rgba(255,214,150,0.35)');
    g.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - w * 0.05, sunY - w * 0.05, w * 0.1, w * 0.1);
  });

  // Nuvens: grupos de manchas achatadas, mais baixas = mais esticadas
  for (let i = 0; i < 90; i += 1) {
    const u = rand();
    const elevation = 0.018 + rand() * rand() * 0.24;       // fração de 90°, puxada pro horizonte
    const y = horizon - elevation * horizon;
    const size = w * (0.008 + rand() * 0.018) * (0.7 + elevation * 4);
    const lit = 1 - Math.min(1, fromSun(u) / 0.3);          // 1 = do lado do sol
    const r = Math.round(196 + lit * 59);
    const g = Math.round(178 + lit * 50);
    const b = Math.round(190 - lit * 22);
    const puffs = 5 + Math.floor(rand() * 6);
    for (let p = 0; p < puffs; p += 1) {
      const dx = (rand() - 0.5) * size * 4.5;
      const dy = (rand() - 0.5) * size * 0.35;
      const radius = size * (0.55 + rand() * 0.8);
      const alpha = 0.12 + rand() * 0.2;
      wrapped(u, (cx) => {
        ctx.save();
        ctx.translate(cx + dx, y + dy);
        ctx.scale(1, 0.3);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        ctx.restore();
      });
    }
  }
  // Ruído fino: quebra as faixas que um degradê de 8 bits deixa
  ctx.fillStyle = ctx.createPattern(noiseTile(rand, 256, 1, 0.012, 0.012), 'repeat');
  ctx.fillRect(0, 0, w, horizon);
}

// Poste alto de iluminação (30 m) com a coroa de refletores
function lightMast(parts, mats, parent, x, z) {
  const { box, cyl, glow } = parts;
  box(parent, mats.concrete, 0.9, 0.5, 0.9, x, 0.25, z);
  cyl(parent, mats.galvanized, 0.13, 15, x, 7.5, z);
  cyl(parent, mats.galvanized, 0.75, 0.1, x, 15, z);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    box(parent, mats.lampOff, 0.32, 0.14, 0.32, x + Math.cos(a) * 0.62, 14.9, z + Math.sin(a) * 0.62);
  }
  glow(parent, 0xfff0cf, 1.6, x, 14.85, z, 0.16);
}

// Guindaste de cais (STS): pórtico, lança sobre o navio, cavalete e tirantes
function stsCrane(parts, mats, parent, x, zWater, zLand, withLoad) {
  const { THREE, track, mergeGeometries, box } = parts;
  const pieces = [];
  const beam = (sx, sy, sz, px, py, pz, rotX = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotX) g.rotateX(rotX);
    g.translate(px, py, pz);
    pieces.push(g);
  };
  const HALF = 5;          // meia distância entre as pernas ao longo do cais
  const TOP = 24;          // altura da lança
  const APEX = 36;
  const zTip = zWater - 30;  // ponta da lança, sobre o navio
  const zRear = zLand + 8;
  [zWater, zLand].forEach((z) => {
    [-HALF, HALF].forEach((dx) => beam(1.0, TOP, 1.0, dx, TOP / 2, z));
    beam(HALF * 2 + 1, 1.0, 1.0, 0, 1.6, z);
    beam(HALF * 2 + 1, 1.2, 1.0, 0, 8, z);
    beam(HALF * 2 + 1, 1.2, 1.0, 0, TOP - 0.6, z);
  });
  [-HALF, HALF].forEach((dx) => {
    beam(0.9, 1.1, zLand - zWater, dx, 8, (zWater + zLand) / 2);
    beam(0.9, 1.4, zLand - zWater, dx, TOP - 0.7, (zWater + zLand) / 2);
  });
  // Lança e viga de ré (duas vigas paralelas) e as travessas entre elas
  [-1.6, 1.6].forEach((dx) => beam(0.9, 1.5, zRear - zTip, dx, TOP + 0.9, (zRear + zTip) / 2));
  for (let z = zTip; z <= zRear; z += 7.6) beam(4.1, 0.5, 0.5, 0, TOP + 0.4, z);
  // Cavalete e tirantes
  [-1.6, 1.6].forEach((dx) => {
    beam(0.8, APEX - TOP, 0.8, dx, (APEX + TOP) / 2, zWater);
    // Tirante do topo do cavalete até um ponto da lança (a caixa é comprida no
    // eixo Z e gira em X até apontar de um ponto pro outro)
    const stay = (zEnd) => {
      const dz = zEnd - zWater;
      const rise = APEX - TOP - 1;
      beam(0.3, 0.3, Math.hypot(dz, rise), dx, (APEX + TOP + 1) / 2, zWater + dz / 2, Math.atan2(rise, dz));
    };
    stay(zTip + 1);
    stay(zTip + 14);
    stay(zRear - 1);
  });
  beam(4.0, 0.6, 0.8, 0, APEX, zWater);
  const merged = track(mergeGeometries(pieces));
  pieces.forEach((g) => g.dispose());
  const frame = new THREE.Mesh(merged, mats.stsPaint);
  frame.position.x = x;
  parent.add(frame);
  // Casa de máquinas, carro e cabine
  box(parent, mats.white, 4.4, 3.2, 7, x, TOP + 3.3, zLand - 1).castShadow = false;
  const zTrolley = zWater - (withLoad ? 13 : 5);
  box(parent, mats.white, 3.4, 1.2, 2.6, x, TOP - 0.5, zTrolley).castShadow = false;
  if (withLoad) {
    box(parent, mats.cable, 0.08, 9, 0.08, x - 1.2, TOP - 5.4, zTrolley).castShadow = false;
    box(parent, mats.cable, 0.08, 9, 0.08, x + 1.2, TOP - 5.4, zTrolley).castShadow = false;
    box(parent, mats.load, 6.1, 1.3, 1.22, x, TOP - 10.6, zTrolley).castShadow = false;
  }
}

/**
 * Monta o fundo: postes no pátio, cais, água, navio e guindastes de cais.
 * `palette` são as cores (hex) dos contêineres, usadas na carga do navio.
 */
export function buildPort(parts, { parent, rand, palette, quayZ, masts, ships }) {
  const { THREE, track, standard, box, cyl, bake } = parts;
  const port = new THREE.Group();
  parent.add(port);
  const mats = {
    concrete: standard({ color: 0x8f918e, roughness: 0.95, metalness: 0 }),
    galvanized: standard({ color: 0xaab2b8, roughness: 0.45, metalness: 0.7 }),
    lampOff: track(new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b8, emissiveIntensity: 0.9, roughness: 0.4 })),
    white: standard({ color: 0xe9ecee, roughness: 0.6, metalness: 0.05 }),
    stsPaint: standard({ color: 0x4f7396, roughness: 0.55, metalness: 0.2 }),
    cable: standard({ color: 0x30353a, roughness: 0.6, metalness: 0.5 }),
    load: standard({ color: 0xd96a1f, roughness: 0.6, metalness: 0.2 }),
    hull: standard({ color: 0x1b2a3d, roughness: 0.55, metalness: 0.25 }),
    boot: standard({ color: 0x7c2a24, roughness: 0.6, metalness: 0.15 }),
    funnel: standard({ color: 0x00796c, roughness: 0.5, metalness: 0.2 }),
    window: standard({ color: 0x0d1b25, roughness: 0.1, metalness: 0.8 }),
    cargo: standard({ color: 0xffffff, roughness: 0.65, metalness: 0.15 }),
    water: standard({ color: 0x2b5a66, roughness: 0.16, metalness: 0.1, envMapIntensity: 1.3 }),
  };

  masts.forEach(([x, z]) => lightMast(parts, mats, port, x, z));

  // ----- Cais e água -----
  box(port, mats.concrete, 1400, 1.6, 1.4, -150, -0.8, quayZ - 0.7).castShadow = false;
  const water = new THREE.Mesh(track(new THREE.PlaneGeometry(3200, 1600)), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.5, quayZ - 800);
  port.add(water);

  // ----- Navios atracados, cada um com seus guindastes de cais -----
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  ships.forEach((shipX) => {
  const ship = new THREE.Group();
  ship.position.set(shipX, -1.5, quayZ - 8.4);
  port.add(ship);
  const LENGTH = 94;
  const BEAM = 13.6;
  const outline = new THREE.Shape();
  const hl = LENGTH / 2;
  const hb = BEAM / 2;
  outline.moveTo(-hl, -hb * 0.8);
  outline.lineTo(-hl + 2, -hb);
  outline.lineTo(hl - 17, -hb);
  outline.quadraticCurveTo(hl - 4, -hb * 0.95, hl, 0);
  outline.quadraticCurveTo(hl - 4, hb * 0.95, hl - 17, hb);
  outline.lineTo(-hl + 2, hb);
  outline.lineTo(-hl, hb * 0.8);
  outline.closePath();
  const hullPart = (depth, material, lift, grow) => {
    const geometry = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 10 });
    geometry.rotateX(-Math.PI / 2); // a extrusão vira a altura
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.position.y = lift;
    mesh.scale.set(grow, 1, grow);
    ship.add(mesh);
  };
  const DECK = 8;                       // altura do convés acima da água
  hullPart(DECK, mats.hull, 0, 1);
  hullPart(1.3, mats.boot, 0, 1.004);   // faixa da linha d'água
  // Superestrutura na popa: casario, ponte com janelas, chaminé e mastro
  box(ship, mats.white, 5.4, 9.5, 12.2, -hl + 5.5, DECK + 4.75, 0).castShadow = false;
  box(ship, mats.white, 4.6, 1.5, 14.6, -hl + 5.9, DECK + 10.2, 0).castShadow = false;
  box(ship, mats.window, 4.7, 0.5, 14.7, -hl + 5.9, DECK + 10.35, 0).castShadow = false;
  box(ship, mats.funnel, 2.4, 3.6, 2.6, -hl + 3.2, DECK + 11.3, 0).castShadow = false;
  cyl(ship, mats.white, 0.12, 4.5, -hl + 6.5, DECK + 13.2, 0).castShadow = false;
  // Carga no convés: uma malha só, com a cor por contêiner
  const slots = [];
  for (let bay = 0; bay < 11; bay += 1) {
    const baseTiers = 3 + Math.floor(rand() * 3);
    for (let row = 0; row < 10; row += 1) {
      const tiers = Math.max(2, baseTiers - (rand() < 0.3 ? 1 : 0));
      for (let tier = 0; tier < tiers; tier += 1) {
        slots.push([-hl + 13 + bay * 6.45, DECK + 0.66 + tier * 1.31, (row - 4.5) * 1.27]);
      }
    }
  }
  const cargo = track(new THREE.InstancedMesh(track(new THREE.BoxGeometry(6.1, 1.29, 1.2)), mats.cargo, slots.length));
  slots.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    cargo.setMatrixAt(i, dummy.matrix);
    cargo.setColorAt(i, color.setHex(palette[Math.floor(rand() * palette.length)]));
  });
  cargo.instanceColor.needsUpdate = true;
  cargo.frustumCulled = false;
  ship.add(cargo);
  [-30, -4, 24].forEach((dx, i) => stsCrane(parts, mats, port, shipX + dx, quayZ + 1.2, quayZ + 16.2, i === 1));
  });
  bake(port); // nada aqui se mexe
}
