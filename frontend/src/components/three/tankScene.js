// Modelo 3D do tanque próprio de combustível (tela "Nível do Tanque"): um
// tanque aéreo horizontal sobre berços, dentro da bacia de contenção, com a
// bomba ao lado. O costado é de vidro pra o combustível aparecer: o nível sobe
// ou desce animado até o valor real, com a superfície ondulando, e duas réguas
// vermelhas marcam o alerta mínimo (piscam quando o nível está abaixo dele).
//
// Num tanque deitado, altura e volume não andam juntos (o meio é mais largo
// que o fundo): a altura do líquido é calculada pelo volume, então o que se
// vê bate com os litros - 50% do volume fica exatamente na metade.
//
// Usado pelo Stage3D: tankScene(ctx, params), params = { fraction (0 a 1),
// minFraction (0 a 1), low (bool) }.

const R = 1;              // raio do costado
const L = 4.4;            // comprimento do costado
const RI = R - 0.035;     // raio interno (onde fica o líquido)
const CY = R + 0.5;       // altura do eixo do tanque sobre o piso
const TANK_X = -0.55;     // tanque um pouco à esquerda: a bomba fica à direita

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;

// Altura do líquido (0 a 2r) pra uma fração do volume de um cilindro deitado
function levelHeight(fraction, r) {
  const f = clamp01(fraction);
  if (f <= 0) return 0;
  if (f >= 1) return 2 * r;
  let lo = 0;
  let hi = 2 * Math.PI;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if ((mid - Math.sin(mid)) / (2 * Math.PI) < f) lo = mid; else hi = mid;
  }
  return r * (1 - Math.cos(lo / 2));
}

export function tankScene(ctx, initial) {
  const { THREE, scene, renderer, track } = ctx;
  renderer.localClippingEnabled = true;
  renderer.toneMappingExposure = 1.05;
  scene.environmentIntensity = 0.85;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f9ba6, 0.8));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.5);
  sun.position.set(-5, 9, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);

  const mat = (opts) => track(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.3, ...opts }));
  const concrete = mat({ color: 0x8c959d, roughness: 0.95, metalness: 0 });

  // Etiquetas desenhadas num canvas (régua de nível, placa do produto). Texto
  // escuro sobre fundo claro: lê bem no tema claro e no escuro.
  const canvasTexture = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const tag = (text, { fg = '#1e293b', bg = 'rgba(255,255,255,0.92)', border = null } = {}) => {
    const map = canvasTexture(256, 112, (g, w, h) => {
      roundRect(g, 6, 6, w - 12, h - 12, 24);
      g.fillStyle = bg;
      g.fill();
      if (border) {
        g.lineWidth = 6;
        g.strokeStyle = border;
        g.stroke();
      }
      g.fillStyle = fg;
      g.font = '700 54px Inter, "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 1);
    });
    const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })));
    sprite.scale.set(0.74, 0.324, 1);
    sprite.renderOrder = 5;
    return sprite;
  };
  // Faixa zebrada amarela e preta da mureta da bacia de contenção
  const hazard = (repeat) => {
    const map = canvasTexture(128, 32, (g, w, h) => {
      g.fillStyle = '#f2b705';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f2328';
      for (let x = -h; x < w + h; x += 32) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 16, h);
        g.lineTo(x + 16 + h, 0);
        g.lineTo(x + h, 0);
        g.closePath();
        g.fill();
      }
    });
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.set(repeat, 1);
    return mat({ map, roughness: 0.7, metalness: 0 });
  };
  const steel = mat({ color: 0xc2cad0, roughness: 0.28, metalness: 0.9 });
  const darkSteel = mat({ color: 0x3b4750, roughness: 0.6, metalness: 0.5 });
  const saddleSteel = mat({ color: 0x6b7780, roughness: 0.5, metalness: 0.55 });
  const paint = mat({ color: 0x008b7b, roughness: 0.38, metalness: 0.25 });
  const white = mat({ color: 0xf2f5f7, roughness: 0.45, metalness: 0.1 });
  const rubber = mat({ color: 0x15181b, roughness: 0.85, metalness: 0 });

  const root = new THREE.Group();
  scene.add(root);
  const tank = new THREE.Group();
  tank.position.x = TANK_X;
  root.add(tank);

  const mesh = (parent, geometry, material, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(track(geometry), material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  };
  const box = (parent, material, sx, sy, sz, x, y, z) => {
    const m = mesh(parent, new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.set(x, y, z);
    return m;
  };
  const cylinder = (parent, material, radius, height, x, y, z, segments = 24) => {
    const m = mesh(parent, new THREE.CylinderGeometry(radius, radius, height, segments), material);
    m.position.set(x, y, z);
    return m;
  };

  // ----- Piso e bacia de contenção -----
  const SLAB_W = L + 3.5;
  const SLAB_D = 3.5;
  box(root, concrete, SLAB_W, 0.16, SLAB_D, 0, -0.08, 0);
  const WALL = 0.2;
  const STRIPE = 0.05; // faixa zebrada pintada no alto da mureta
  const longCurb = hazard(SLAB_W / 0.6);
  const shortCurb = hazard((SLAB_D - 0.2) / 0.6);
  [-1, 1].forEach((s) => {
    box(root, concrete, SLAB_W, WALL - STRIPE, 0.1, 0, (WALL - STRIPE) / 2, s * (SLAB_D / 2 - 0.05));
    box(root, concrete, 0.1, WALL - STRIPE, SLAB_D - 0.2, s * (SLAB_W / 2 - 0.05), (WALL - STRIPE) / 2, 0);
    box(root, longCurb, SLAB_W, STRIPE, 0.1, 0, WALL - STRIPE / 2, s * (SLAB_D / 2 - 0.05));
    box(root, shortCurb, 0.1, STRIPE, SLAB_D - 0.2, s * (SLAB_W / 2 - 0.05), WALL - STRIPE / 2, 0);
  });

  // ----- Berços (com o recorte curvo onde o tanque apoia) -----
  const cradle = R + 0.015;
  const spread = 0.98; // meio ângulo do apoio
  const halfW = cradle * Math.sin(spread) + 0.16;
  const topY = CY - cradle * Math.cos(spread);
  const saddleShape = new THREE.Shape();
  saddleShape.moveTo(-halfW, 0);
  saddleShape.lineTo(halfW, 0);
  saddleShape.lineTo(halfW, topY);
  saddleShape.lineTo(cradle * Math.sin(spread), topY);
  saddleShape.absarc(0, CY, cradle, -Math.PI / 2 + spread, -Math.PI / 2 - spread, true);
  saddleShape.lineTo(-halfW, topY);
  saddleShape.closePath();
  const saddleGeometry = new THREE.ExtrudeGeometry(saddleShape, { depth: 0.3, bevelEnabled: false, curveSegments: 24 });
  saddleGeometry.translate(0, 0, -0.15);
  saddleGeometry.rotateY(Math.PI / 2);
  track(saddleGeometry);
  [-1, 1].forEach((s) => {
    const saddle = new THREE.Mesh(saddleGeometry, saddleSteel);
    saddle.position.x = s * L * 0.29;
    saddle.castShadow = true;
    saddle.receiveShadow = true;
    tank.add(saddle);
  });

  // ----- Líquido: um cilindro cheio, cortado na altura do nível -----
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), CY - RI);
  const fuel = track(new THREE.MeshStandardMaterial({
    color: 0xc98510, roughness: 0.3, metalness: 0, side: THREE.DoubleSide,
    emissive: 0x7a4300, emissiveIntensity: 0.45, clippingPlanes: [cut], envMapIntensity: 0.6,
  }));
  const liquidGeometry = new THREE.CylinderGeometry(RI, RI, L - 0.02, 56, 1, false);
  liquidGeometry.rotateZ(Math.PI / 2);
  const liquid = mesh(tank, liquidGeometry, fuel, { cast: false, receive: false });
  liquid.position.y = CY;

  // Superfície do líquido (ondula; a largura acompanha a corda do círculo)
  const SEG_X = 48;
  const SEG_Z = 8;
  const surfaceGeometry = new THREE.PlaneGeometry(L - 0.02, 1, SEG_X, SEG_Z);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surface = mesh(tank, surfaceGeometry, track(new THREE.MeshStandardMaterial({
    color: 0xf0b43c, roughness: 0.08, metalness: 0.05, side: THREE.DoubleSide,
    emissive: 0x8a5a00, emissiveIntensity: 0.35, envMapIntensity: 1.1,
  })), { cast: false, receive: false });
  const surfacePos = surfaceGeometry.attributes.position;

  // ----- Costado de vidro, cintas e tampos -----
  const glassGeometry = new THREE.CylinderGeometry(R, R, L, 64, 1, true);
  glassGeometry.rotateZ(Math.PI / 2);
  const glass = mesh(tank, glassGeometry, track(new THREE.MeshStandardMaterial({
    color: 0xd4ebf2, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.2,
  })), { cast: false, receive: false });
  glass.position.y = CY;
  glass.renderOrder = 2;

  const band = (x, thickness) => {
    const geometry = new THREE.TorusGeometry(R + 0.012, thickness, 12, 64);
    geometry.rotateY(Math.PI / 2);
    const m = mesh(tank, geometry, steel);
    m.position.set(x, CY, 0);
  };
  band(-L / 2, 0.06);
  band(L / 2, 0.06);

  // Tampos abaulados; pintados dos dois lados porque o lado de dentro aparece
  // através do vidro
  const headPaint = mat({ color: 0x008b7b, roughness: 0.38, metalness: 0.25, side: THREE.DoubleSide });
  [-1, 1].forEach((s) => {
    const head = new THREE.SphereGeometry(R, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    head.rotateZ(-s * (Math.PI / 2)); // polo apontando pra fora
    head.scale(0.36, 1, 1);
    const m = mesh(tank, head, headPaint);
    m.position.set(s * (L / 2), CY, 0);
  });

  // Boca de visita, respiro e bocal de enchimento
  const TOP = CY + R;
  cylinder(tank, steel, 0.27, 0.12, -0.55, TOP + 0.04, 0, 28);
  cylinder(tank, darkSteel, 0.31, 0.04, -0.55, TOP + 0.12, 0, 28);
  cylinder(tank, steel, 0.035, 0.8, L * 0.3, TOP + 0.38, 0, 12);
  cylinder(tank, darkSteel, 0.075, 0.05, L * 0.3, TOP + 0.8, 0, 14);
  cylinder(tank, steel, 0.06, 0.26, -L * 0.32, TOP + 0.1, 0, 14);
  cylinder(tank, paint, 0.085, 0.05, -L * 0.32, TOP + 0.25, 0, 14);

  // ----- Réguas do alerta mínimo (por fora do vidro, na frente e atrás) -----
  const alertMaterial = track(new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0 }));
  const alertBars = [-1, 1].map(() => {
    const bar = mesh(tank, new THREE.BoxGeometry(L * 0.97, 0.045, 0.04), alertMaterial, { cast: false, receive: false });
    return bar;
  });

  // Etiqueta "MÍN" na ponta da régua do alerta, do lado de quem olha
  const minTag = tag('MÍN', { fg: '#ffffff', bg: 'rgba(220,38,38,0.95)' });
  minTag.scale.multiplyScalar(0.8);
  tank.add(minTag);

  // ----- Régua de nível na frente do costado -----
  // Um arco fino do fundo ao topo, com traços em 25/50/75% do VOLUME (a altura
  // de cada traço vem do mesmo cálculo do líquido, então 50% fica no meio)
  const SCALE_X = -L / 2 + 0.42;
  const scaleMaterial = mat({ color: 0xf8fafc, roughness: 0.4, metalness: 0.1 });
  const arcGeometry = new THREE.TorusGeometry(R + 0.012, 0.009, 6, 48, Math.PI);
  arcGeometry.rotateZ(-Math.PI / 2);
  arcGeometry.rotateY(-Math.PI / 2);
  const arc = mesh(tank, arcGeometry, scaleMaterial, { cast: false, receive: false });
  arc.position.set(SCALE_X, CY, 0);
  [0.25, 0.5, 0.75].forEach((f) => {
    const y = CY - R + levelHeight(f, R);
    const a = Math.asin((y - CY) / R); // ângulo do traço no costado (0 = meio)
    const tick = mesh(tank, new THREE.BoxGeometry(0.16, 0.018, 0.018), scaleMaterial, { cast: false, receive: false });
    tick.position.set(SCALE_X + 0.07, y, Math.cos(a) * (R + 0.014));
    const label = tag(`${Math.round(f * 100)}%`);
    label.position.set(SCALE_X - 0.36, y, Math.cos(a) * (R + 0.08));
    tank.add(label);
  });

  // Placa do produto no costado (encostada na curva, virada pra frente)
  const PLATE_ANGLE = 0.62;
  const plateMap = canvasTexture(256, 96, (g, w, h) => {
    roundRect(g, 3, 3, w - 6, h - 6, 10);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#f2b705';
    g.stroke();
    g.fillStyle = '#0f172a';
    g.font = '700 40px Inter, "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DIESEL S-10', w / 2, h / 2 + 2);
  });
  const plate = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.2, 0.45)),
    track(new THREE.MeshStandardMaterial({ map: plateMap, roughness: 0.5, metalness: 0, transparent: true })),
  );
  plate.position.set(L * 0.12, CY + Math.sin(PLATE_ANGLE) * (R + 0.02), Math.cos(PLATE_ANGLE) * (R + 0.02));
  plate.rotation.x = -PLATE_ANGLE;
  plate.renderOrder = 3;
  tank.add(plate);

  // ----- Bomba de abastecimento -----
  const pump = new THREE.Group();
  pump.position.set(TANK_X + L / 2 + 1.45, 0, 0.75);
  root.add(pump);
  box(pump, darkSteel, 0.62, 0.08, 0.5, 0, 0.04, 0);
  box(pump, white, 0.52, 0.95, 0.4, 0, 0.55, 0);
  box(pump, paint, 0.54, 0.2, 0.42, 0, 1.12, 0);
  const display = box(pump, track(new THREE.MeshStandardMaterial({ color: 0x0b1620, emissive: 0x1fb5a5, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2 })), 0.34, 0.2, 0.012, 0, 0.78, 0.206);
  display.castShadow = false;
  // Mangueira: sai da lateral, faz a barriga e volta pro bico no suporte
  const hose = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.26, 0.42, 0.06),
    new THREE.Vector3(0.5, 0.28, 0.1),
    new THREE.Vector3(0.6, 0.55, 0.12),
    new THREE.Vector3(0.44, 0.86, 0.1),
    new THREE.Vector3(0.3, 0.9, 0.08),
  ]);
  mesh(pump, new THREE.TubeGeometry(hose, 28, 0.028, 8, false), rubber);
  box(pump, darkSteel, 0.1, 0.16, 0.06, 0.28, 0.86, 0.08);
  // Tubulação: desce do fundo do tanque e segue rente ao piso até a bomba
  const pipeY = 0.3;
  const pipeFrom = L * 0.42;
  cylinder(tank, steel, 0.04, CY - RI - pipeY + 0.06, pipeFrom, (CY - RI + pipeY) / 2, 0, 12);
  const pipeLength = (pump.position.x - TANK_X) - pipeFrom;
  const pipe = cylinder(tank, steel, 0.04, pipeLength, pipeFrom + pipeLength / 2, pipeY, 0, 12);
  pipe.rotation.z = Math.PI / 2;
  const elbow = cylinder(pump, steel, 0.04, 0.75, 0, pipeY, -0.375, 12);
  elbow.rotation.x = Math.PI / 2;

  // ----- Estado: o nível mostrado vai atrás do nível real -----
  let target = clamp01(initial?.fraction || 0);
  let minFraction = clamp01(initial?.minFraction || 0);
  let low = !!initial?.low;
  let level = 0;
  let slosh = 1; // começa agitado: o tanque "enche" na entrada
  const placeAlert = () => {
    const show = minFraction > 0.002 && minFraction < 0.998;
    const y = CY - R + levelHeight(minFraction, R);
    const half = Math.sqrt(Math.max(0, R * R - (y - CY) ** 2)) + 0.02;
    alertBars.forEach((bar, i) => {
      bar.visible = show;
      bar.position.set(0, y, (i ? 1 : -1) * half);
    });
    minTag.visible = show;
    minTag.position.set(L / 2 - 0.15, y, half + 0.12);
  };
  placeAlert();

  const applyLevel = (time, amplitude) => {
    const y = CY - RI + levelHeight(level, RI);
    cut.constant = y;
    const chord = 2 * Math.sqrt(Math.max(0, RI * RI - (y - CY) ** 2));
    const wet = level > 0.0005;
    liquid.visible = wet;
    surface.visible = wet && level < 0.9995;
    surface.position.y = y;
    surface.scale.z = Math.max(0.001, chord);
    for (let i = 0; i < surfacePos.count; i += 1) {
      const x = surfacePos.getX(i);
      const z = surfacePos.getZ(i);
      surfacePos.setY(i, amplitude * (
        Math.sin(x * 3.1 + time * 2.3) * 0.6 + Math.sin(x * 5.7 - time * 3.2 + z * 4.0) * 0.4
      ));
    }
    surfacePos.needsUpdate = true;
    surfaceGeometry.computeVertexNormals();
  };

  // ----- Câmera: vista de três quartos, com um vaivém lento -----
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const focus = new THREE.Vector3(0.1, CY - 0.45, 0);
  let distance = 12;
  const resize = (aspect) => {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    distance = Math.max(2.2 / tan, 4.85 / (tan * aspect)) * 1.02;
  };

  const update = (time, delta) => {
    const previous = level;
    if (time > 0.45) level += (target - level) * (1 - Math.exp(-delta * 2.0));
    if (Math.abs(target - level) < 0.0004) level = target;
    const speed = Math.abs(level - previous) / Math.max(delta, 0.001);
    slosh += (Math.min(1, speed * 5) - slosh) * (1 - Math.exp(-delta * 2.5));
    applyLevel(time, 0.006 + slosh * 0.03);

    alertMaterial.emissiveIntensity = low ? 1.5 + Math.sin(time * 4.2) * 1.0 : 0.9;

    const intro = 1 - easeOut(time / 1.3);
    const angle = 0.3 + Math.sin(time * 0.28) * 0.11 + ctx.pointer.x * 0.12 - intro * 0.3;
    const d = distance * (1 + intro * 0.12);
    camera.position.set(
      focus.x + Math.sin(angle) * d,
      focus.y + d * 0.17 - ctx.pointer.y * 0.35,
      focus.z + Math.cos(angle) * d,
    );
    camera.lookAt(focus);
  };

  return {
    camera,
    update,
    resize,
    idle: () => level === target && slosh < 0.05,
    setParams(next) {
      target = clamp01(next?.fraction || 0);
      minFraction = clamp01(next?.minFraction || 0);
      low = !!next?.low;
      placeAlert();
    },
  };
}
