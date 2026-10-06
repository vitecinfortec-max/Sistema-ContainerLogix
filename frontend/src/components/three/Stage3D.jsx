import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { prefilterEnvironment, studioCanvas } from './environment';

// Palco dos modelos 3D embutidos nas telas (tanque de combustível, mini-pátio
// do Dashboard). Cuida de tudo que é igual pra qualquer modelo: carregar o
// three.js sob demanda, criar o renderizador com fundo transparente (o modelo
// fica "em cima" do card, no tema claro ou escuro), acompanhar o tamanho do
// card, parar de desenhar quando o modelo sai da tela ou a aba fica em segundo
// plano, e aliviar em máquina fraca (baixa a resolução, depois desliga as
// sombras, por fim deixa um quadro parado).
//
// A montagem é feita em etapas, sem segurar a página: os shaders compilam em
// segundo plano e as texturas vão pra placa de vídeo antes do primeiro quadro
// (numa placa antiga, montar tudo de uma vez travava a tela por mais de 1 s -
// e o Dashboard monta o modelo toda vez que é aberto).
//
// A cena em si vem em `scene`: uma função (ctx, params) que monta o modelo em
// ctx.scene e devolve { camera, update(tempo, delta), setParams(params),
// resize(proporção), idle() }. `params` são os dados da tela (ex.: nível do tanque);
// quando mudam, o modelo é avisado por setParams e anima até o novo valor.
//
// Sem WebGL (ou se o contexto cair) o componente mostra `fallback` - a versão
// 2D do mesmo dado. Com "reduzir movimento" ligado, fica um quadro parado.

const STILL_TIME = 1000; // "tempo" usado pro quadro parado: tudo já assentado

// Confere se o navegador tem WebGL 2 antes de baixar o three.js (sem isso o
// modelo nem tenta montar: entra direto a versão 2D)
function webglAvailable() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

const loadThree = () => Promise.all([
  import('three'),
  import('three/examples/jsm/utils/BufferGeometryUtils.js'),
]).then(([THREE, { mergeGeometries }]) => ({ THREE, mergeGeometries }));

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'];

function startStage(lib, mount, createScene, initialParams, { animated, onFail }) {
  const { THREE } = lib;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  mount.appendChild(renderer.domElement);

  const disposables = [];
  const track = (obj) => { disposables.push(obj); return obj; };
  const scene = new THREE.Scene();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  let stopped = false;
  let still = !animated;
  let started = false;
  let frame = 0;
  let model = null;
  let params = initialParams;
  let teardown = () => {}; // desfaz o que a montagem ligou (observadores, eventos)

  const renderStill = () => {
    if (stopped || !started) return;
    model.update(STILL_TIME, 10);
    renderer.render(scene, model.camera);
  };

  // Fim de etapa: devolve o controle pro navegador e espera a placa de vídeo
  // terminar o que ficou na fila - consultando, sem segurar a página.
  // Devolve `true` se o palco foi desmontado no meio.
  const gl = renderer.getContext();
  const settle = async () => {
    const fence = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    for (let i = 0; i < 500; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, i ? 8 : 0); });
      if (stopped || !fence) break;
      if (gl.clientWaitSync(fence, 0, 0) !== gl.TIMEOUT_EXPIRED) break;
    }
    if (fence) gl.deleteSync(fence);
    return stopped;
  };

  const build = async () => {
    // Reflexos suaves de ambiente (vidro, aço e tinta deixam de parecer plástico)
    const studio = track(new THREE.CanvasTexture(studioCanvas()));
    studio.colorSpace = THREE.SRGBColorSpace;
    studio.mapping = THREE.EquirectangularReflectionMapping;
    const environment = await prefilterEnvironment(THREE, renderer, studio, () => stopped);
    if (environment) track(environment);
    if (stopped || !environment) return;
    scene.environment = environment.texture;
    if (await settle()) return;

    model = createScene({ ...lib, renderer, scene, track, pointer, animated }, params);
    const { camera } = model;
    // As texturas do modelo vão pra placa de vídeo já, não no primeiro quadro
    const textures = new Set();
    scene.traverse((object) => [].concat(object.material || []).forEach((material) => {
      TEXTURE_SLOTS.forEach((slot) => { if (material[slot]) textures.add(material[slot]); });
    }));
    textures.forEach((texture) => renderer.initTexture(texture));
    if (await settle()) return;

    // O modelo acompanha de leve o mouse (posição relativa ao próprio card)
    const onPointerMove = (e) => {
      const rect = mount.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    };
    if (animated) window.addEventListener('pointermove', onPointerMove, { passive: true });

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      model.resize(w / h);
      camera.updateProjectionMatrix();
      if (still) renderStill();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let visible = true;
    const visibilityObserver = new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; });
    visibilityObserver.observe(mount);

    let last = 0;
    let lastDraw = 0;
    let pending = 0;
    let time = 0;
    let frames = 0;
    let slowTime = 0;
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      pending += Math.min((now - (last || now)) / 1000, 0.1);
      last = now;
      if (document.hidden || !visible) { pending = 0; return; }
      // Modelo assentado (só o vaivém lento da câmera): ~30 quadros por segundo
      // bastam - a tela pode ficar aberta o dia inteiro
      if (model.idle && model.idle() && now - lastDraw < 30) return;
      lastDraw = now;
      const delta = Math.min(pending, 0.1);
      pending = 0;
      time += delta;
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      model.update(time, delta);
      renderer.render(scene, camera);

      // Máquina fraca: média acima de ~50 ms por quadro -> alivia em etapas
      frames += 1;
      if (time > 1.5 && frames < 600) {
        slowTime += delta;
        if (frames % 45 === 0) {
          if (slowTime / 45 > 0.05) {
            if (pixelRatio > 1) {
              pixelRatio = 1;
              renderer.setPixelRatio(1);
              resize();
            } else if (renderer.shadowMap.enabled) {
              renderer.shadowMap.enabled = false;
              scene.traverse((o) => {
                if (o.isLight) o.castShadow = false;
                if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; });
              });
            } else {
              still = true;
              cancelAnimationFrame(frame);
              renderStill();
            }
          }
          slowTime = 0;
        }
      }
    };

    const onContextLost = (e) => { e.preventDefault(); onFail(); };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    teardown = () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    };

    // Compila os shaders em segundo plano e só então desenha; a montagem
    // termina com o primeiro quadro, que é quando o card faz o fade de entrada
    await (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).catch(() => {});
    if (stopped) return;
    started = true;
    if (still) renderStill();
    else frame = requestAnimationFrame(loop);
  };

  const stage = {
    ready: null,
    // Os dados podem mudar antes de o modelo existir: vale o último valor
    setParams(next) {
      params = next;
      if (stopped || !model) return;
      model.setParams(next);
      if (still) renderStill();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      teardown();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  // Erro na montagem (ex.: modelo com defeito): desmonta e mostra a versão 2D
  stage.ready = build().catch(() => { onFail(); });
  return stage;
}

export default function Stage3D({ scene, params, className, fallback = null, ariaLabel, startDelay = 350, testId }) {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [status, setStatus] = useState('loading'); // loading | ready | failed

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let cancelled = false;
    const stopStage = () => {
      if (stageRef.current) stageRef.current.stop();
      stageRef.current = null;
    };
    const fail = () => {
      if (cancelled) return;
      stopStage();
      setStatus('failed');
    };
    if (!webglAvailable()) {
      fail();
      return undefined;
    }
    const animated = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Espera a entrada da tela terminar: montar o modelo ocupa a CPU por um
    // instante e travaria essa animação
    const timer = setTimeout(() => {
      loadThree()
        .then((lib) => {
          if (cancelled) return;
          const stage = startStage(lib, mount, scene, paramsRef.current, { animated, onFail: fail });
          stageRef.current = stage;
          // (se a montagem falhou, o palco já foi trocado pela versão 2D)
          stage.ready.then(() => { if (!cancelled && stageRef.current === stage) setStatus('ready'); });
        })
        .catch(fail);
    }, startDelay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopStage();
    };
  }, [scene, startDelay]);

  // Os dados mudaram: o modelo anima até o novo valor
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    if (stageRef.current) stageRef.current.setParams(paramsRef.current);
  }, [paramsKey]);

  if (status === 'failed') return fallback;
  return (
    <div
      ref={mountRef}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      data-stage={status}
      className={cn('transition-opacity duration-700', status === 'ready' ? 'opacity-100' : 'opacity-0', className)}
    />
  );
}
