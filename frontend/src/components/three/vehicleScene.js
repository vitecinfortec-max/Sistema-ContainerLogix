// Modelo 3D do guia de fotos do Checklist de Veículo: o veículo (cavalo,
// carreta ou carro) sobre uma plataforma, e a câmera voa até o ângulo da foto
// que está sendo pedida - o que aparece no quadro é o enquadramento esperado.
// Nas fotos de detalhe (pneus, painel) um anel marca o ponto a fotografar.
// Dá pra arrastar na horizontal pra girar; ao soltar, a câmera volta.
//
// Usado pelo Stage3D: vehicleScene(ctx, params), params = { type ('CAMINHAO' |
// 'CARRETA' | 'CARRO' - fixo: trocar o tipo é remontar o palco), active
// (posição da foto, ou null pra vista geral), complete (todas as posições
// fotografadas: o aro da plataforma fica verde) }.

import { HEIGHT, WIDTH, seeded, createContainerKit } from './containerKit';
import { createParts } from './sceneParts';
import { truckMaterials, buildTractor, buildTrailer } from './truck';
import { buildCar } from './car';

const DEG = Math.PI / 180;
const DECK_Y = 0.66;

// Cada veículo: como montar, a caixa que ele ocupa (meio comprimento, meia
// largura e altura, já centrado) e os pontos das fotos de detalhe.
// Eixos: frente no +X, lado esquerdo (do motorista) no -Z.
const VEHICLES = {
  CAMINHAO: {
    centerX: 2.925,
    box: { halfX: 1.53, halfZ: 0.72, height: 2.34 },
    tires: { x: -0.745, y: 0.27, z: -0.62, width: 1.45, height: 1.0 },
    speedometer: { x: 1.1, y: 1.5, z: -0.3, width: 1.5, height: 1.15, azimuth: -52, elevation: 10 },
    build: (parts, mats) => buildTractor(parts, mats).group,
  },
  CARRETA: {
    centerX: 0.325,
    box: { halfX: 2.26, halfZ: 0.64, height: DECK_Y + HEIGHT },
    tires: { x: -1.26, y: 0.27, z: -0.62, width: 1.45, height: 1.0 },
    speedometer: null,
    build: (parts, mats, ctx) => {
      const { THREE, mergeGeometries, track } = ctx;
      const { group } = buildTrailer(parts, mats, { width: WIDTH, deckY: DECK_Y });
      // Contêiner de 20' em cima, com as portas pra traseira
      const kit = createContainerKit(THREE, { mergeGeometries, track, rand: seeded(7) });
      const look = kit.look(0x008b7b, 'CLX');
      const cargo = new THREE.Group();
      [[kit.bodyGeo[20], look[20]], [kit.frameGeo[20], look.frame]].forEach(([geometry, material]) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        cargo.add(mesh);
      });
      cargo.position.set(-0.05, DECK_Y + HEIGHT / 2, 0);
      cargo.rotation.y = Math.PI;
      group.add(cargo);
      return group;
    },
  },
  CARRO: {
    centerX: 0,
    box: { halfX: 1.08, halfZ: 0.47, height: 0.77 },
    tires: { x: 0.65, y: 0.165, z: -0.42, width: 0.85, height: 0.6 },
    speedometer: { x: 0.38, y: 0.52, z: -0.18, width: 0.95, height: 0.7, azimuth: -58, elevation: 16 },
    build: (parts, mats) => buildCar(parts, mats).group,
  },
};
// Ângulo da câmera em cada foto de corpo inteiro (0° = de frente, -90° = do
// lado esquerdo). Um pouco fora do eixo, pra o modelo não ficar chapado.
const VIEWS = {
  front: { azimuth: -14, elevation: 6 },
  back: { azimuth: 194, elevation: 6 },
  left_side: { azimuth: -86, elevation: 5 },
  right_side: { azimuth: 86, elevation: 5 },
};
const OVERVIEW = { azimuth: -38, elevation: 13 };

const shortestArc = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function vehicleScene(ctx, initial) {
  const { THREE, scene, renderer, track, mergeGeometries } = ctx;
  renderer.toneMappingExposure = 1.05;
  scene.environmentIntensity = 0.9;

  const type = VEHICLES[initial?.type] ? initial.type : 'CAMINHAO';
  const vehicle = VEHICLES[type];
  const { halfX, halfZ, height } = vehicle.box;

  // Luz principal vinda da frente-esquerda e uma de preenchimento do lado
  // oposto: as quatro faces precisam aparecer bem, cada uma na sua foto
  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.85));
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
  sun.position.set(halfX + 3, 7, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const reach = halfX + 1.4;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfeaf5, 1.1);
  fill.position.set(-halfX - 3, 4, 5);
  scene.add(fill);

  // ----- Veículo, centrado na plataforma -----
  const parts = createParts(THREE, { track, mergeGeometries });
  const model = vehicle.build(parts, truckMaterials(parts, seeded(20261006)), ctx);
  model.position.x = -vehicle.centerX;
  scene.add(model);

  // ----- Plataforma: disco claro + aro na cor da marca -----
  const radius = Math.hypot(halfX, halfZ) + 0.35;
  const platform = new THREE.Mesh(
    track(new THREE.CylinderGeometry(radius, radius, 0.05, 72)),
    track(new THREE.MeshStandardMaterial({ color: 0xe3e8ed, roughness: 0.92, metalness: 0 })),
  );
  platform.position.y = -0.025;
  platform.receiveShadow = true;
  scene.add(platform);
  const rimMaterial = track(new THREE.MeshStandardMaterial({ color: 0x0f9d8c, emissive: 0x0f9d8c, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0 }));
  const rimGeometry = track(new THREE.TorusGeometry(radius - 0.02, 0.014, 8, 96));
  rimGeometry.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.y = 0.012;
  scene.add(rim);
  const RIM_PENDING = new THREE.Color(0x0f9d8c);
  const RIM_DONE = new THREE.Color(0x22c55e);

  // ----- Anel que marca o ponto das fotos de detalhe -----
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = 128;
  ringCanvas.height = 128;
  const ringCtx = ringCanvas.getContext('2d');
  ringCtx.strokeStyle = 'rgba(255,255,255,0.95)';
  ringCtx.lineWidth = 9;
  ringCtx.beginPath();
  ringCtx.arc(64, 64, 50, 0, Math.PI * 2);
  ringCtx.stroke();
  ringCtx.fillStyle = 'rgba(255,255,255,0.16)';
  ringCtx.fill();
  const ringTexture = track(new THREE.CanvasTexture(ringCanvas));
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Sprite(track(new THREE.SpriteMaterial({
    map: ringTexture, color: 0x14e0c8, transparent: true, depthTest: false, depthWrite: false,
  })));
  ring.renderOrder = 5;
  ring.visible = false;
  scene.add(ring);
  let ringSize = 0.5;

  // ----- Câmera -----
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  let aspect = 1;

  // Onde a câmera fica pra uma posição de foto: ângulos, ponto de mira e o
  // tamanho (largura x altura) do que precisa caber no quadro
  const shotFor = (active) => {
    const detail = active === 'tires' || active === 'speedometer' ? vehicle[active] : null;
    if (detail) {
      return {
        azimuth: (detail.azimuth ?? -74) * DEG,
        elevation: (detail.elevation ?? 7) * DEG,
        target: [detail.x, detail.y, detail.z],
        width: detail.width,
        height: detail.height,
        depth: 0.25,
        ring: Math.min(detail.width, detail.height) * 0.62,
      };
    }
    const view = VIEWS[active] || OVERVIEW;
    const azimuth = view.azimuth * DEG;
    const elevation = view.elevation * DEG;
    const depth = halfX * Math.abs(Math.cos(azimuth)) + halfZ * Math.abs(Math.sin(azimuth));
    return {
      azimuth,
      elevation,
      target: [0, height * 0.47, 0],
      width: 2 * (halfX * Math.abs(Math.sin(azimuth)) + halfZ * Math.abs(Math.cos(azimuth))),
      height: height * Math.cos(elevation) + 2 * depth * Math.sin(elevation),
      depth,
      ring: 0,
    };
  };
  // O veículo ocupa a faixa do meio do visor: em cima fica a etiqueta da
  // posição e embaixo a legenda (por isso a altura conta com folga maior)
  const distanceFor = (shot) => Math.max(shot.height / (2 * tan * 0.78), (shot.width * 1.12) / (2 * tan * aspect)) + shot.depth;

  let shot = shotFor(initial?.active);
  let complete = !!initial?.complete;
  // Entrada: a câmera chega girando, um pouco mais de longe
  const current = {
    azimuth: shot.azimuth - 0.7,
    elevation: shot.elevation + 0.12,
    distance: 0,
    target: new THREE.Vector3(...shot.target),
  };
  const goal = new THREE.Vector3(...shot.target);
  let settled = false;

  // ----- Arrastar pra girar -----
  const drag = { active: false, lastX: 0, yaw: 0, releasedAt: -10 };
  let clock = 0;
  if (ctx.animated) {
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    const onDown = (e) => {
      drag.active = true;
      drag.lastX = e.clientX;
      canvas.style.cursor = 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag.active) return;
      drag.yaw += (e.clientX - drag.lastX) * 0.009;
      drag.lastX = e.clientX;
    };
    const onUp = () => {
      if (!drag.active) return;
      drag.active = false;
      drag.releasedAt = clock;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    track({
      dispose() {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
      },
    });
  }

  const update = (time, delta) => {
    clock = time;
    const k = 1 - Math.exp(-delta * 3.4);
    const turn = shortestArc(shot.azimuth - current.azimuth);
    const distance = distanceFor(shot);
    if (!current.distance) current.distance = distance * 1.25;
    current.azimuth += turn * k;
    current.elevation += (shot.elevation - current.elevation) * k;
    current.distance += (distance - current.distance) * k;
    goal.set(...shot.target);
    current.target.lerp(goal, k);
    settled = Math.abs(turn) < 0.002 && Math.abs(distance - current.distance) < 0.004;

    // Depois de solto, o giro manual volta sozinho pro ângulo da foto
    if (!drag.active && time - drag.releasedAt > 0.9) {
      drag.yaw *= Math.exp(-delta * 2.6);
      if (Math.abs(drag.yaw) < 0.002) drag.yaw = 0;
    }

    // Vaivém leve (parado, o modelo pareceria uma foto) + acompanha o mouse
    const sway = ctx.animated ? Math.sin(time * 0.45) * 0.03 : 0;
    const azimuth = current.azimuth + drag.yaw + sway + ctx.pointer.x * 0.07;
    const elevation = Math.max(0.02, current.elevation - ctx.pointer.y * 0.04);
    // Em giros longos a câmera abre um pouco, pra não raspar no veículo
    const d = current.distance * (1 + Math.min(0.22, Math.abs(turn) * 0.1));
    // A câmera inteira desce um pouco: o veículo sobe no quadro, pra longe da legenda
    const lift = d * tan * 0.07;
    camera.position.set(
      current.target.x + Math.cos(elevation) * Math.cos(azimuth) * d,
      current.target.y + Math.sin(elevation) * d - lift,
      current.target.z + Math.cos(elevation) * Math.sin(azimuth) * d,
    );
    camera.lookAt(current.target.x, current.target.y - lift, current.target.z);

    ring.visible = shot.ring > 0;
    if (ring.visible) {
      ringSize += (shot.ring - ringSize) * k;
      ring.position.copy(goal);
      ring.scale.setScalar(ringSize * (1 + Math.sin(time * 3.2) * 0.07));
      ring.material.opacity = 0.75 + Math.sin(time * 3.2) * 0.2;
    }
    rimMaterial.color.lerp(complete ? RIM_DONE : RIM_PENDING, k);
    rimMaterial.emissive.copy(rimMaterial.color);
  };

  return {
    camera,
    update,
    resize(nextAspect) { aspect = nextAspect; },
    idle: () => settled && !drag.active && drag.yaw === 0,
    setParams(next) {
      shot = shotFor(next?.active);
      complete = !!next?.complete;
    },
  };
}
