// Carro de passeio (hatch de frota), na mesma escala do caminhão (1 unidade =
// 2 m) e com os mesmos materiais (truckMaterials): 4,3 m de comprimento,
// centrado na origem, com a frente apontando pro +X.
//
// buildCar(parts, mats) devolve { group, wheels, wheelRadius }, igual buildTruck.

const WHEEL_R = 0.165;      // pneu de ~66 cm
const AXLES = [-0.65, 0.65];
const BEVEL = 0.03;
const BODY_HALF = 0.41;     // meia largura da carroceria, sem o arredondado
const CABIN_HALF = 0.395;   // a cabine é mais estreita que a carroceria

export function buildCar(parts, mats) {
  const { THREE, track, box, cyl, wheel, mergedBoxes, glow, bake } = parts;
  const group = new THREE.Group();
  const wheels = [];

  const shapeOf = (points) => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    return shape;
  };
  // Perfil lateral extrudado na largura (z vai de -half a +half)
  const extruded = (shape, half, material, { bevel = 0, shadows = true } = {}) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: half * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 4,
    });
    geometry.translate(0, 0, -half);
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
    return mesh;
  };

  // ----- Carroceria (do para-choque até a linha de cintura) -----
  extruded(shapeOf([
    [-1.01, 0.15], [0.97, 0.15], [1.03, 0.23], [1.03, 0.33], [0.97, 0.4],
    [0.42, 0.46], [-0.94, 0.485], [-1.02, 0.43], [-1.04, 0.24],
  ]), BODY_HALF, mats.paint, { bevel: BEVEL });
  const SIDE = BODY_HALF + BEVEL; // face lateral da carroceria

  // ----- Cabine: miolo de vidro + laterais com o recorte das janelas + teto -----
  const cabin = [[0.44, 0.47], [0.1, 0.735], [-0.62, 0.745], [-0.97, 0.495]];
  extruded(shapeOf(cabin), CABIN_HALF - 0.025, mats.glass, { shadows: false });
  const sideFrame = shapeOf(cabin);
  [
    [[0.3, 0.5], [0.06, 0.7], [-0.22, 0.705], [-0.22, 0.5]],     // janela dianteira
    [[-0.28, 0.5], [-0.28, 0.705], [-0.6, 0.712], [-0.87, 0.51]], // janela traseira
  ].forEach((points) => {
    const hole = new THREE.Path();
    points.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
    hole.closePath();
    sideFrame.holes.push(hole);
  });
  const frameGeometry = track(new THREE.ExtrudeGeometry(sideFrame, { depth: 0.03, bevelEnabled: false }));
  [CABIN_HALF - 0.03, -CABIN_HALF].forEach((z) => {
    const frame = new THREE.Mesh(frameGeometry, mats.paint);
    frame.position.z = z;
    frame.castShadow = true;
    group.add(frame);
  });
  const roof = box(group, mats.paint, 0.74, 0.03, CABIN_HALF * 2, -0.26, 0.748, 0);
  roof.rotation.z = -Math.atan2(0.01, 0.72);

  // ----- Rodas, com a caixa de roda escura por trás -----
  AXLES.forEach((x) => [-1, 1].forEach((s) => {
    cyl(group, mats.plastic, 0.205, 0.03, x, WHEEL_R, s * (SIDE - 0.012), 'z');
    wheels.push(wheel(group, mats.rubber, mats.rim, WHEEL_R, 0.12, x, WHEEL_R, s * (SIDE - 0.035)));
  }));

  // ----- Frente: grade, entrada de ar, faróis e placa -----
  const FRONT = 1.03 + BEVEL;
  box(group, mats.plastic, 0.02, 0.06, 0.4, FRONT + 0.004, 0.3, 0);
  box(group, mats.plastic, 0.02, 0.05, 0.62, FRONT + 0.004, 0.2, 0);
  box(group, mats.alu, 0.012, 0.055, 0.2, FRONT + 0.012, 0.25, 0);
  [-0.3, 0.3].forEach((z) => {
    box(group, mats.lamp, 0.03, 0.055, 0.19, FRONT - 0.004, 0.345, z);
    glow(group, 0xfff1c9, 0.17, FRONT + 0.03, 0.345, z, 0.3);
  });

  // ----- Traseira: lanternas, para-choque e placa -----
  const REAR = -1.04 - BEVEL;
  [-0.31, 0.31].forEach((z) => box(group, mats.tail, 0.03, 0.07, 0.17, REAR + 0.012, 0.41, z));
  box(group, mats.plastic, 0.03, 0.07, 0.8, REAR + 0.006, 0.2, 0);
  box(group, mats.alu, 0.012, 0.055, 0.2, REAR - 0.006, 0.31, 0);

  // ----- Laterais: saia, faixa da frota, frisos das portas, maçanetas e retrovisores -----
  [-1, 1].forEach((s) => {
    const z = s * (SIDE + 0.003);
    box(group, mats.plastic, 0.98, 0.035, 0.012, 0, 0.14, z);
    box(group, mats.stripe, 1.1, 0.04, 0.008, -0.22, 0.34, z);
    mergedBoxes(group, mats.dark, [
      [0.008, 0.3, 0.006, 0.33, 0.31, z], [0.008, 0.32, 0.006, -0.25, 0.32, z], [0.008, 0.28, 0.006, -0.8, 0.33, z],
      [0.07, 0.018, 0.012, -0.14, 0.42, z], [0.07, 0.018, 0.012, -0.69, 0.42, z],
    ]);
    box(group, mats.plastic, 0.05, 0.045, 0.09, 0.36, 0.5, s * (CABIN_HALF + 0.05));
  });

  bake(group, (object) => wheels.includes(object));

  return { group, wheels, wheelRadius: WHEEL_R };
}
