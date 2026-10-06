// Guindaste de pórtico sobre pneus (RTG) da cena de login, em escala
// (1 unidade = 2 m): vão de ~20 m sobre a quadra e a faixa do caminhão,
// 16 m de altura livre. Tem o que um RTG de verdade tem à vista: vigas-caixão,
// truques com pneus grandes, casa de máquinas e gerador na viga de base,
// passarela com guarda-corpo, escada de acesso, carro com casa de máquinas e
// cabine envidraçada pendurada, spreader com headblock e os 8 cabos de aço.
//
// buildRtg(parts, mats, dims) devolve { gantry, setHook(z, alturaDoSpreader),
// beaconMaterial }. Quem anima só move gantry.position.x e chama setHook.

export function rtgMaterials(parts, rand) {
  const { THREE, track, standard } = parts;
  const dirt = parts.grime(rand);
  return {
    yellow: standard({ color: 0xf0b100, roughness: 0.5, metalness: 0.1, map: dirt }),
    dark: standard({ color: 0x2a2f35, roughness: 0.62, metalness: 0.45 }),
    white: standard({ color: 0xe4e8eb, roughness: 0.55, metalness: 0.1, map: dirt }),
    glass: standard({ color: 0x1b3a4c, roughness: 0.06, metalness: 0.7, envMapIntensity: 2.4 }),
    rubber: standard({ color: 0x141618, roughness: 0.9, metalness: 0 }),
    steel: standard({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.85 }),
    hazard: standard({ map: parts.hazard(), roughness: 0.6, metalness: 0.05 }),
    lamp: track(new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 1.3, roughness: 0.4 })),
    beacon: track(new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9500, emissiveIntensity: 2, roughness: 0.4 })),
  };
}

const SILL_Y = 1.2;        // centro da viga de base
const LEG_BOTTOM = 1.45;
const LEG_TOP = 7.9;
const BEAM_Y = 8.2;        // centro da viga de pórtico (une as duas pernas de um lado)
const GIRDER_Y = 8.95;     // centro das vigas principais
const GIRDER_TOP = 9.4;
const TROLLEY_Y = 9.55;

// Texto pintado (número do equipamento, nome do terminal)
function plate(parts, w, h, lines) {
  return parts.canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    lines.forEach(({ text, x, size, weight = 900, color = 'rgba(22,24,27,0.9)', align = 'left' }) => {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.font = `${weight} ${Math.round(h * size)}px "Arial Black", Impact, Arial, sans-serif`;
      ctx.fillText(text, w * x, h * 0.52);
    });
  });
}

export function buildRtg(parts, mats, { legX, zBack, zFront, len20, width, number = '07' }) {
  const { THREE, track, box, cyl, wheel, railing, ladder, mergedBoxes, decal, bake } = parts;
  const span = zFront - zBack;
  const zMid = (zFront + zBack) / 2;
  const gantry = new THREE.Group();

  // ----- Os dois lados do pórtico: viga de base, pernas, viga de cima, truques -----
  const sillLength = legX * 2 + 2.3;
  [zBack, zFront].forEach((z) => {
    box(gantry, mats.yellow, sillLength, 0.5, 0.56, 0, SILL_Y, z);
    [-1, 1].forEach((s) => box(gantry, mats.hazard, 0.55, 0.5, 0.58, s * (sillLength / 2 - 0.27), SILL_Y, z));
    [-legX, legX].forEach((x) => {
      box(gantry, mats.yellow, 0.46, LEG_TOP - LEG_BOTTOM, 0.5, x, (LEG_TOP + LEG_BOTTOM) / 2, z);
      box(gantry, mats.yellow, 0.6, 0.5, 0.58, x, LEG_TOP - 0.2, z);      // reforço do nó de cima
      box(gantry, mats.yellow, 0.6, 0.26, 0.6, x, LEG_BOTTOM + 0.13, z);  // flange da base
    });
    box(gantry, mats.yellow, legX * 2 + 0.6, 0.6, 0.52, 0, BEAM_Y, z);
    // Truques: balancim com 2 pneus em cada canto
    [-1, 1].forEach((s) => {
      const bx = s * (legX + 0.55);
      box(gantry, mats.dark, 1.5, 0.2, 0.5, bx, 0.87, z);
      [-0.5, 0.5].forEach((dx) => {
        wheel(gantry, mats.rubber, mats.yellow, 0.42, 0.3, bx + dx, 0.42, z);
        box(gantry, mats.dark, 0.14, 0.48, 0.05, bx + dx, 0.63, z + 0.19);
        box(gantry, mats.dark, 0.14, 0.48, 0.05, bx + dx, 0.63, z - 0.19);
      });
    });
  });

  // Na viga de base de trás (longe do caminhão): gerador e casa elétrica
  const deckY = LEG_BOTTOM;
  box(gantry, mats.white, 1.65, 1.05, 0.8, -0.92, deckY + 0.525, zBack);
  mergedBoxes(gantry, mats.dark, [...Array(7)].map((_, i) => [1.1, 0.035, 0.02, -0.92, deckY + 0.3 + i * 0.09, 0.41]), 0, 0, zBack);
  cyl(gantry, mats.steel, 0.05, 1.0, -0.3, deckY + 1.5, zBack - 0.2);
  box(gantry, mats.white, 1.6, 1.15, 0.78, 0.95, deckY + 0.575, zBack);
  box(gantry, mats.dark, 1.7, 0.05, 0.86, 0.95, deckY + 1.17, zBack);
  box(gantry, mats.dark, 0.42, 0.82, 0.02, 0.6, deckY + 0.47, zBack + 0.4);
  // Na da frente só o que não tampa a vista: eletrocalha e a placa do equipamento
  box(gantry, mats.dark, legX * 2 - 0.6, 0.08, 0.2, 0, deckY + 0.04, zFront - 0.12);
  decal(gantry, plate(parts, 512, 64, [
    { text: `RTG ${number}`, x: 0.03, size: 0.82 },
    { text: 'CLX TERMINAL', x: 0.97, size: 0.5, align: 'right' },
  ]), 3.3, 0.41, 0, SILL_Y, zFront + 0.285);

  // ----- Vigas principais (o carro anda em cima delas) -----
  const girderLength = span + 1.5;
  [-1.2, 1.2].forEach((x) => {
    box(gantry, mats.yellow, 0.5, 0.9, girderLength, x, GIRDER_Y, zMid);
    box(gantry, mats.dark, 0.08, 0.06, girderLength - 0.2, x, GIRDER_TOP + 0.03, zMid);
    [-1, 1].forEach((s) => box(gantry, mats.dark, 0.2, 0.2, 0.14, x, GIRDER_TOP + 0.13, zMid + s * (girderLength / 2 - 0.1)));
    // Refletores de trabalho por baixo
    [-0.3, 0, 0.3].forEach((k) => box(gantry, mats.lamp, 0.24, 0.07, 0.3, x, GIRDER_Y - 0.49, zMid + k * span));
  });
  [-1, 1].forEach((s) => box(gantry, mats.yellow, 2.9, 0.5, 0.3, 0, GIRDER_Y - 0.05, zMid + s * (girderLength / 2 - 0.15)));
  decal(gantry, plate(parts, 1024, 128, [
    { text: 'CLX', x: 0.03, size: 0.86 },
    { text: `RTG ${number}  ·  41 t`, x: 0.97, size: 0.46, align: 'right' },
  ]), 5.2, 0.65, 1.2 + 0.256, GIRDER_Y, zMid, Math.PI / 2);

  // Passarela de manutenção com guarda-corpo, do lado oposto à cabine
  const walkX = -1.2 - 0.25 - 0.22;
  const walkFrom = zMid - (girderLength / 2 - 0.2);
  const walkTo = zMid + (girderLength / 2 - 0.2);
  box(gantry, mats.dark, 0.44, 0.04, walkTo - walkFrom, walkX, GIRDER_Y + 0.1, zMid);
  railing(gantry, mats.yellow, 'z', walkFrom, walkTo, walkX - 0.21, GIRDER_Y + 0.12, 0);
  // Escada de acesso pela perna da frente, com patamares de descanso
  const ladderX = -legX - 0.27;
  ladder(gantry, mats.yellow, ladderX, LEG_BOTTOM + 0.05, GIRDER_Y + 0.1, zFront);
  [3.9, 6.3].forEach((y) => {
    box(gantry, mats.dark, 0.5, 0.04, 0.62, ladderX - 0.22, y, zFront);
    railing(gantry, mats.yellow, 'z', zFront - 0.31, zFront + 0.31, ladderX - 0.47, y + 0.02, 0, 0.5);
  });
  box(gantry, mats.dark, 1.1, 0.04, 0.66, -legX + 0.1, GIRDER_Y + 0.1, zFront);

  // ----- Carro (trolley): casa de máquinas em cima, cabine pendurada do lado -----
  const trolley = new THREE.Group();
  trolley.position.y = TROLLEY_Y;
  gantry.add(trolley);
  mergedBoxes(trolley, mats.dark, [
    [3.0, 0.2, 0.24, 0, 0, -0.85], [3.0, 0.2, 0.24, 0, 0, 0.85],
    [0.3, 0.2, 1.94, -1.2, 0, 0], [0.3, 0.2, 1.94, 1.2, 0, 0],
    [0.24, 0.16, 1.5, -0.45, 0, 0], [0.24, 0.16, 1.5, 0.45, 0, 0],
  ]);
  [-1.2, 1.2].forEach((x) => [-0.7, 0.7].forEach((z) => cyl(trolley, mats.steel, 0.11, 0.12, x, -0.06, z, 'x')));
  box(trolley, mats.white, 1.8, 0.8, 1.3, -0.2, 0.52, 0);
  box(trolley, mats.dark, 1.92, 0.05, 1.42, -0.2, 0.945, 0);
  mergedBoxes(trolley, mats.dark, [...Array(5)].map((_, i) => [0.02, 0.035, 0.8, 0.71, 0.32 + i * 0.09, 0]));
  box(trolley, mats.dark, 0.5, 0.42, 0.9, 1.0, 0.31, 0); // motores do içamento
  cyl(trolley, mats.steel, 0.012, 0.7, -0.95, 1.3, 0.5); // anemômetro
  const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 12, 8)), mats.beacon);
  beacon.position.set(-0.2, 1.06, 0);
  trolley.add(beacon);
  // Roldanas de onde descem os cabos
  const TOP_ANCHOR = { x: 0.75, y: -0.12, z: 0.45 };
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => cyl(trolley, mats.steel, 0.13, 0.1, sx * TOP_ANCHOR.x, -0.06, sz * TOP_ANCHOR.z, 'x')));
  // Cabine do operador: passa por cima da viga e fica pendurada do lado de fora
  box(trolley, mats.dark, 1.2, 0.14, 0.3, 1.75, 0.05, 0);
  [-0.35, 0.35].forEach((z) => box(trolley, mats.dark, 0.07, 0.8, 0.07, 2.0, -0.38, z));
  box(trolley, mats.white, 0.92, 0.1, 1.02, 2.0, -0.8, 0);
  box(trolley, mats.dark, 0.9, 0.08, 1.0, 2.0, -1.72, 0);
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => box(trolley, mats.white, 0.06, 0.86, 0.06, 2.0 + sx * 0.42, -1.27, sz * 0.47)));
  const cabGlass = box(trolley, mats.glass, 0.82, 0.84, 0.92, 2.0, -1.27, 0);
  cabGlass.castShadow = false;

  // ----- Spreader (quadro que trava no contêiner) + headblock -----
  const spreader = new THREE.Group();
  gantry.add(spreader);
  const endX = len20 / 2 - 0.09;
  box(spreader, mats.yellow, len20 * 0.6, 0.16, 0.55, 0, 0.01, 0);
  [-1, 1].forEach((s) => {
    box(spreader, mats.yellow, len20 * 0.2, 0.11, 0.36, s * len20 * 0.39, 0, 0);
    box(spreader, mats.yellow, 0.16, 0.13, width * 0.99, s * endX, -0.01, 0);
    [-1, 1].forEach((sz) => {
      box(spreader, mats.dark, 0.15, 0.1, 0.15, s * endX, -0.035, sz * (width / 2 - 0.08)); // travas (twistlocks)
      const flipper = box(spreader, mats.yellow, 0.025, 0.2, 0.18, s * (len20 / 2 + 0.035), -0.13, sz * (width / 2 - 0.13));
      flipper.rotation.z = -s * 0.22;
    });
  });
  box(spreader, mats.dark, 1.5, 0.24, 0.85, 0, 0.23, 0);
  const BOTTOM_ANCHOR = { x: 0.55, y: 0.5, z: 0.3 };
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => cyl(spreader, mats.steel, 0.12, 0.09, sx * BOTTOM_ANCHOR.x, 0.42, sz * BOTTOM_ANCHOR.z, 'x')));

  // ----- Cabos de aço: 2 por roldana, do carro até o headblock -----
  const ropeGeometry = track(new THREE.CylinderGeometry(0.014, 0.014, 1, 5));
  ropeGeometry.translate(0, 0.5, 0); // base no headblock, cresce na direção do carro
  const ropes = [];
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [-0.035, 0.035].forEach((offset) => {
    const mesh = new THREE.Mesh(ropeGeometry, mats.steel);
    gantry.add(mesh);
    ropes.push({
      mesh,
      bottom: new THREE.Vector3(sx * BOTTOM_ANCHOR.x + offset, BOTTOM_ANCHOR.y, sz * BOTTOM_ANCHOR.z),
      top: new THREE.Vector3(sx * TOP_ANCHOR.x + offset, TOP_ANCHOR.y, sz * TOP_ANCHOR.z),
    });
  })));
  // Tudo que não se mexe sozinho vira poucas malhas: o carro, o spreader e
  // a estrutura (os cabos mudam de tamanho a cada quadro e ficam de fora)
  bake(trolley);
  bake(spreader);
  const ropeMeshes = new Set(ropes.map((rope) => rope.mesh));
  bake(gantry, (object) => object === trolley || object === spreader || ropeMeshes.has(object));

  const UP = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  /** Põe o carro em z e o spreader na altura dada (origem do spreader). */
  const setHook = (z, spreaderY) => {
    trolley.position.z = z;
    spreader.position.set(0, spreaderY, z);
    ropes.forEach(({ mesh, bottom, top }) => {
      from.copy(bottom).add(spreader.position);
      to.copy(top).add(trolley.position).sub(from);
      const length = Math.max(0.05, to.length());
      mesh.position.copy(from);
      mesh.scale.y = length;
      mesh.quaternion.setFromUnitVectors(UP, to.divideScalar(length));
    });
  };

  return { gantry, setHook, beaconMaterial: mats.beacon };
}
