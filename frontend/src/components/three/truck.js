// Caminhão da cena de login, em escala (1 unidade = 2 m): cavalo mecânico 6x2
// de cabine avançada + semirreboque porta-contêiner de 20' ("bug").
// A frente aponta pro +X; o contêiner apoia em deckY, centrado em x = -0.05.
//
// buildTruck(parts, mats, dims) devolve { group, wheels, wheelRadius }: quem
// anima move group.position.x e gira as rodas (rotation.z).

export function truckMaterials(parts, rand) {
  const { THREE, track, standard } = parts;
  return {
    paint: track(new THREE.MeshPhysicalMaterial({ color: 0xf3f5f6, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2 })),
    stripe: standard({ color: 0x008b7b, roughness: 0.4, metalness: 0.1 }),
    dark: standard({ color: 0x22262b, roughness: 0.65, metalness: 0.4 }),
    plastic: standard({ color: 0x2f3338, roughness: 0.8, metalness: 0.05 }),
    chassis: standard({ color: 0x2c4764, roughness: 0.55, metalness: 0.3, map: parts.grime(rand) }),
    glass: standard({ color: 0x16303f, roughness: 0.05, metalness: 0.75, envMapIntensity: 2.4 }),
    rubber: standard({ color: 0x131517, roughness: 0.9, metalness: 0 }),
    rim: standard({ color: 0xc9cfd4, roughness: 0.35, metalness: 0.8 }),
    alu: standard({ color: 0xd4d9dd, roughness: 0.28, metalness: 0.9 }),
    lamp: track(new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b8, emissiveIntensity: 2.2, roughness: 0.3 })),
    tail: track(new THREE.MeshStandardMaterial({ color: 0xb01212, emissive: 0xe01010, emissiveIntensity: 1.3, roughness: 0.4 })),
    amber: track(new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff7a00, emissiveIntensity: 0.6, roughness: 0.5 })),
    reflective: standard({
      roughness: 0.5,
      metalness: 0.1,
      map: parts.canvasTexture(128, 16, (ctx, w, h) => {
        for (let i = 0; i < 8; i += 1) {
          ctx.fillStyle = i % 2 ? '#f2f2f2' : '#c4161c';
          ctx.fillRect((i * w) / 8, 0, w / 8, h);
        }
      }),
    }),
  };
}

const WHEEL_R = 0.27;       // pneu de ~1,08 m
const FRONT_AXLE = 3.78;
const DRIVE_AXLES = [1.88, 2.48];
const TRAILER_AXLES = [-1.25, -0.62];

export function buildTruck(parts, mats, { width, deckY }) {
  const { THREE, track, box, cyl, wheel, mergedBoxes, glow, bake } = parts;
  const group = new THREE.Group();
  const wheels = [];
  const dual = (x) => [-0.57, -0.37, 0.37, 0.57].forEach((z) => wheels.push(wheel(group, mats.rubber, mats.rim, WHEEL_R, 0.17, x, WHEEL_R, z)));
  const axle = (x) => cyl(group, mats.dark, 0.05, 1.16, x, WHEEL_R, 0, 'z');

  // ----- Semirreboque porta-contêiner -----
  [-0.3, 0.3].forEach((z) => {
    box(group, mats.chassis, 3.4, 0.16, 0.09, -0.17, 0.53, z);   // longarina
    box(group, mats.chassis, 1.15, 0.16, 0.09, 2.0, 0.62, z);    // pescoço (passa por cima do cavalo)
    box(group, mats.chassis, 0.12, 0.25, 0.09, 1.47, 0.575, z);
  });
  mergedBoxes(group, mats.chassis, [-1.1, -0.4, 0.3, 1.0, 1.9, 2.5].map((x) => [0.06, 0.12, 0.6, x, x > 1.45 ? 0.62 : 0.53, 0]));
  // Travessas onde o contêiner apoia, com as travas nos cantos
  [1.4, -1.5].forEach((x) => {
    box(group, mats.chassis, 0.16, 0.1, width + 0.02, x, deckY - 0.05, 0);
    [-1, 1].forEach((s) => box(group, mats.amber, 0.1, 0.06, 0.08, x, deckY - 0.02, s * (width / 2 + 0.01)));
  });
  TRAILER_AXLES.forEach((x) => {
    dual(x);
    axle(x);
    [-0.3, 0.3].forEach((z) => box(group, mats.dark, 0.3, 0.2, 0.06, x, 0.4, z));
  });
  [-0.47, 0.47].forEach((z) => {
    box(group, mats.plastic, 1.2, 0.025, 0.38, -0.93, 0.585, z);  // para-lama
    box(group, mats.rubber, 0.015, 0.26, 0.36, -1.62, 0.36, z);   // para-barro
  });
  // Traseira: para-choque com faixa refletiva e lanternas
  box(group, mats.reflective, 0.07, 0.12, width + 0.02, -1.9, 0.45, 0);
  box(group, mats.dark, 0.04, 0.15, width - 0.04, -1.9, 0.6, 0);
  [-0.46, 0.46].forEach((z) => box(group, mats.tail, 0.03, 0.08, 0.2, -1.925, 0.6, z));
  box(group, mats.paint, 0.012, 0.07, 0.2, -1.925, 0.6, 0); // placa
  // Pés de apoio (recolhidos) e refletores laterais
  [-0.36, 0.36].forEach((z) => {
    box(group, mats.dark, 0.07, 0.3, 0.07, 1.05, 0.34, z);
    box(group, mats.dark, 0.15, 0.02, 0.15, 1.05, 0.185, z);
  });
  [-0.9, 0.1, 1.1].forEach((x) => [-0.35, 0.35].forEach((z) => box(group, mats.amber, 0.09, 0.03, 0.012, x, 0.53, z)));

  // ----- Cavalo mecânico -----
  [-0.24, 0.24].forEach((z) => box(group, mats.dark, 2.95, 0.14, 0.09, 2.87, 0.5, z)); // chassi
  DRIVE_AXLES.forEach((x) => { dual(x); axle(x); });
  [-0.5, 0.5].forEach((z) => wheels.push(wheel(group, mats.rubber, mats.rim, WHEEL_R, 0.2, FRONT_AXLE, WHEEL_R, z)));
  axle(FRONT_AXLE);
  cyl(group, mats.dark, 0.32, 0.06, 2.15, 0.585, 0); // quinta roda
  [-0.47, 0.47].forEach((z) => {
    box(group, mats.plastic, 1.36, 0.03, 0.36, 2.18, 0.6, z); // para-lamas traseiros
    cyl(group, mats.alu, 0.19, 0.74, 2.98, 0.4, z, 'x');      // tanques de combustível
    [2.76, 3.2].forEach((x) => cyl(group, mats.dark, 0.196, 0.035, x, 0.4, z, 'x'));
    box(group, mats.tail, 0.03, 0.07, 0.16, 1.4, 0.5, z * 0.85);
  });
  cyl(group, mats.alu, 0.045, 1.5, 3.1, 1.32, 0.5);  // escapamento vertical
  box(group, mats.dark, 0.14, 0.5, 0.16, 3.1, 0.9, 0.5);

  // Cabine: perfil lateral extrudado na largura, com as quinas arredondadas
  const BEVEL = 0.03;
  const profile = new THREE.Shape();
  [[3.2, 0.55], [4.3, 0.55], [4.32, 0.98], [4.32, 1.24], [4.17, 1.84], [4.04, 1.96], [3.2, 1.96]]
    .forEach(([x, y], i) => (i ? profile.lineTo(x, y) : profile.moveTo(x, y)));
  profile.closePath();
  const cabGeometry = new THREE.ExtrudeGeometry(profile, {
    depth: 1.18, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 3, curveSegments: 4,
  });
  cabGeometry.translate(0, 0, -0.59);
  const cab = new THREE.Mesh(track(cabGeometry), mats.paint);
  cab.castShadow = true;
  cab.receiveShadow = true;
  group.add(cab);
  const SIDE = 0.59 + BEVEL;   // face lateral da cabine
  const FRONT = 4.32 + BEVEL;  // face da frente
  // Defletor de ar no teto
  const deflector = new THREE.Shape();
  [[3.22, 1.96 + BEVEL], [3.98, 1.96 + BEVEL], [3.28, 2.34]].forEach(([x, y], i) => (i ? deflector.lineTo(x, y) : deflector.moveTo(x, y)));
  deflector.closePath();
  const deflectorGeometry = new THREE.ExtrudeGeometry(deflector, { depth: 1.1, bevelEnabled: false });
  deflectorGeometry.translate(0, 0, -0.55);
  const spoiler = new THREE.Mesh(track(deflectorGeometry), mats.paint);
  spoiler.castShadow = true;
  group.add(spoiler);

  // Vidros: para-brisa inclinado e janelas das portas
  const windshield = box(group, mats.glass, 0.02, 0.57, 1.08, 4.245 + BEVEL + 0.008, 1.548, 0);
  windshield.rotation.z = Math.atan2(0.15, 0.6);
  windshield.castShadow = false;
  [-1, 1].forEach((s) => {
    const z = s * (SIDE + 0.004);
    const side = box(group, mats.glass, 0.5, 0.44, 0.012, 3.87, 1.56, z);
    side.castShadow = false;
    box(group, mats.stripe, 1.02, 0.11, 0.008, 3.74, 1.13, z);          // faixa da frota
    mergedBoxes(group, mats.dark, [                                      // frisos da porta e maçaneta
      [0.01, 1.2, 0.006, 3.52, 1.2, z], [0.01, 1.2, 0.006, 4.18, 1.2, z], [0.09, 0.025, 0.01, 3.6, 1.24, z],
    ]);
    box(group, mats.plastic, 0.5, 0.05, 0.1, 3.95, 0.6, s * (SIDE + 0.02));  // degraus
    box(group, mats.plastic, 0.5, 0.05, 0.1, 3.95, 0.42, s * (SIDE + 0.04));
    box(group, mats.plastic, 0.03, 0.03, 0.16, 4.2, 1.72, s * (SIDE + 0.07)); // braço do retrovisor
    box(group, mats.plastic, 0.06, 0.34, 0.12, 4.22, 1.56, s * (SIDE + 0.13)); // retrovisor
  });
  // Frente: grade, para-choque, faróis e placa
  box(group, mats.plastic, 0.02, 0.27, 0.94, FRONT + 0.006, 1.1, 0);
  mergedBoxes(group, mats.alu, [0.99, 1.08, 1.17].map((y) => [0.012, 0.018, 0.86, FRONT + 0.02, y, 0]));
  box(group, mats.plastic, 0.16, 0.3, 1.26, 4.33, 0.66, 0);
  box(group, mats.plastic, 0.16, 0.04, 1.16, 4.2, 1.9, 0); // quebra-sol
  box(group, mats.paint, 0.012, 0.07, 0.2, 4.414, 0.6, 0);
  [-0.44, 0.44].forEach((z) => {
    box(group, mats.lamp, 0.03, 0.1, 0.24, 4.412, 0.72, z);
    glow(group, 0xfff1c9, 0.55, 4.46, 0.72, z, 0.55);
  });

  bake(group, (object) => wheels.includes(object)); // as rodas giram; o resto é fixo

  return { group, wheels, wheelRadius: WHEEL_R };
}
