// Peças básicas pra montar os modelos 3D das cenas (guindaste, caminhão,
// cenário do porto): caixas e cilindros que reaproveitam uma geometria só,
// rodas com pneu e aro, guarda-corpos, escadas de marinheiro, placas com
// texto desenhado em canvas e os "brilhos" de lâmpada.
//
// createParts(THREE, { track, mergeGeometries }) devolve as funções; `track`
// recebe tudo que precisa de dispose() quando a cena é desmontada.

/**
 * Ladrilho de ruído: pontinhos brancos e pretos semitransparentes sobre fundo
 * transparente. Usado como padrão de preenchimento (createPattern), cobre uma
 * textura inteira com um único fillRect - muito mais barato que desenhar
 * dezenas de milhares de pontinhos um a um.
 */
export function noiseTile(rand, size, density, lightAlpha, darkAlpha) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i += 1) {
    if (rand() <= density) {
      const light = rand() > 0.5;
      d[i * 4] = light ? 255 : 0;
      d[i * 4 + 1] = d[i * 4];
      d[i * 4 + 2] = d[i * 4];
      d[i * 4 + 3] = Math.round((light ? lightAlpha : darkAlpha) * (0.4 + rand() * 0.6) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function createParts(THREE, { track, mergeGeometries }) {
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const unitCyl = track(new THREE.CylinderGeometry(1, 1, 1, 20));

  const standard = (opts) => track(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, ...opts }));

  const place = (parent, mesh, x, y, z, shadows = true) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  };

  const box = (parent, material, sx, sy, sz, x, y, z) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(sx, sy, sz);
    return place(parent, mesh, x, y, z);
  };

  // Cilindro com o eixo em 'x', 'y' ou 'z'
  const cyl = (parent, material, radius, length, x, y, z, axis = 'y') => {
    const mesh = new THREE.Mesh(unitCyl, material);
    mesh.scale.set(radius, length, radius);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    return place(parent, mesh, x, y, z);
  };

  // Junta várias caixas numa malha só (detalhe fino sem multiplicar desenhos)
  const mergedBoxes = (parent, material, boxes, x = 0, y = 0, z = 0) => {
    const parts = boxes.map(([sx, sy, sz, px, py, pz]) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(px, py, pz);
      return g;
    });
    const merged = track(mergeGeometries(parts));
    parts.forEach((g) => g.dispose());
    return place(parent, new THREE.Mesh(merged, material), x, y, z);
  };

  // ----- Rodas: pneu com ombro arredondado + aro rebaixado com cubo -----
  const wheelCache = new Map();
  const wheelGeometry = (radius, width) => {
    const key = `${radius}|${width}`;
    if (!wheelCache.has(key)) {
      const h = width / 2;
      const s = Math.min(width * 0.24, radius * 0.14);
      const profile = [
        [radius * 0.58, -h], [radius - s, -h], [radius, -h + s],
        [radius, h - s], [radius - s, h], [radius * 0.58, h],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const tyre = new THREE.LatheGeometry(profile, 28);
      tyre.rotateX(Math.PI / 2); // eixo no Z: a roda rola ao longo do X
      const rim = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width * 0.6, 20);
      const cap = new THREE.CylinderGeometry(radius * 0.2, radius * 0.26, width * 1.02, 10);
      const hub = mergeGeometries([rim, cap]);
      hub.rotateX(Math.PI / 2);
      rim.dispose();
      cap.dispose();
      wheelCache.set(key, { tyre: track(tyre), hub: track(hub) });
    }
    return wheelCache.get(key);
  };
  const wheel = (parent, tyreMaterial, rimMaterial, radius, width, x, y, z) => {
    const geo = wheelGeometry(radius, width);
    const group = new THREE.Group();
    [[geo.tyre, tyreMaterial], [geo.hub, rimMaterial]].forEach(([geometry, material]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  };

  // Guarda-corpo reto ao longo do eixo 'x' ou 'z': corrimão, travessa do meio
  // e montantes, tudo numa malha
  const railing = (parent, material, axis, from, to, x, y, z, height = 0.55) => {
    const along = (len, at, yy, tall) => (axis === 'x'
      ? [len, tall, 0.025, at, yy, 0]
      : [0.025, tall, len, 0, yy, at]);
    const length = Math.abs(to - from);
    const mid = (from + to) / 2;
    const boxes = [along(length, mid, height, 0.03), along(length, mid, height * 0.5, 0.022)];
    const posts = Math.max(2, Math.round(length / 0.9) + 1);
    for (let i = 0; i < posts; i += 1) {
      boxes.push(along(0.025, from + ((to - from) * i) / (posts - 1), height / 2, height));
    }
    return mergedBoxes(parent, material, boxes, x, y, z);
  };

  // Escada de marinheiro vertical (montantes + degraus), encostada num plano x
  const ladder = (parent, material, x, y0, y1, z) => {
    const height = y1 - y0;
    const boxes = [
      [0.03, height, 0.03, 0, height / 2, -0.13],
      [0.03, height, 0.03, 0, height / 2, 0.13],
    ];
    for (let y = 0.14; y < height; y += 0.15) boxes.push([0.022, 0.022, 0.26, 0, y, 0]);
    return mergedBoxes(parent, material, boxes, x, y0, z);
  };

  // Textura desenhada em canvas (placas, faixas zebradas, sujeira)
  const canvasTexture = (w, h, paint, { srgb = true, repeat } = {}) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paint(canvas.getContext('2d'), w, h);
    const texture = track(new THREE.CanvasTexture(canvas));
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat[0], repeat[1]);
    }
    return texture;
  };

  // Placa plana com textura (fundo transparente), um fio à frente da superfície
  const planeGeo = track(new THREE.PlaneGeometry(1, 1));
  const decal = (parent, texture, w, h, x, y, z, rotationY = 0, opts = {}) => {
    const material = track(new THREE.MeshStandardMaterial({
      map: texture, transparent: true, roughness: 0.7, metalness: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, ...opts,
    }));
    const mesh = new THREE.Mesh(planeGeo, material);
    mesh.scale.set(w, h, 1);
    mesh.rotation.y = rotationY;
    return place(parent, mesh, x, y, z, false);
  };

  // Brilho de lâmpada: um disco de luz sempre virado pra câmera
  let glowTexture = null;
  const glow = (parent, color, size, x, y, z, opacity = 1) => {
    if (!glowTexture) {
      glowTexture = canvasTexture(64, 64, (ctx) => {
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
      });
    }
    const material = track(new THREE.SpriteMaterial({
      map: glowTexture, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(size);
    sprite.position.set(x, y, z);
    parent.add(sprite);
    return sprite;
  };

  // Sujeira leve pra tinta não ficar chapada (multiplica a cor do material)
  const grime = (rand) => canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${rand() * 0.1})` : `rgba(60,48,36,${rand() * 0.09})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
    }
    for (let i = 0; i < 60; i += 1) {
      const x = rand() * w;
      const y = rand() * h * 0.5;
      const len = h * (0.2 + rand() * 0.6);
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, `rgba(50,40,30,${0.05 + rand() * 0.1})`);
      g.addColorStop(1, 'rgba(50,40,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 1 + rand() * 4, len);
    }
  }, { repeat: [1, 1] });

  // Faixa zebrada amarela e preta (sinalização de segurança)
  const hazard = () => canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#f0b400';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#16181b';
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 16, h);
      ctx.lineTo(x + 16 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
  }, { repeat: [1, 1] });

  /**
   * Junta numa malha só tudo que é fixo dentro de um grupo e usa o mesmo
   * material (um guindaste tem mais de cem caixinhas; desenhadas uma a uma
   * pesam à toa). `moves(objeto)` marca o que tem movimento próprio (rodas,
   * carro do guindaste): isso e o que estiver dentro fica como está.
   */
  const bake = (group, moves = () => false) => {
    group.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map();
    const baked = [];
    group.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || Array.isArray(object.material)) return;
      for (let o = object; o && o !== group; o = o.parent) if (moves(o)) return;
      const key = `${object.material.uuid}|${object.castShadow}|${object.receiveShadow}`;
      if (!buckets.has(key)) buckets.set(key, { object, pieces: [] });
      const piece = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      Object.keys(piece.attributes).forEach((name) => { if (!['position', 'normal', 'uv'].includes(name)) piece.deleteAttribute(name); });
      piece.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, object.matrixWorld));
      buckets.get(key).pieces.push(piece);
      baked.push(object);
    });
    baked.forEach((object) => object.parent.remove(object));
    buckets.forEach(({ object, pieces }) => {
      const merged = track(mergeGeometries(pieces));
      pieces.forEach((piece) => piece.dispose());
      const mesh = new THREE.Mesh(merged, object.material);
      mesh.castShadow = object.castShadow;
      mesh.receiveShadow = object.receiveShadow;
      group.add(mesh);
    });
  };

  return { THREE, track, mergeGeometries, standard, box, cyl, mergedBoxes, wheel, railing, ladder, canvasTexture, decal, glow, grime, hazard, bake };
}
