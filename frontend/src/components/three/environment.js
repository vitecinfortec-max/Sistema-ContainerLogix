// Mapa de reflexos do ambiente (o que faz vidro, aço e tinta refletirem o
// céu) preparado sem travar a página.
//
// O three.js gera esse mapa com alguns shaders próprios (filtros de borrão),
// e a placa de vídeo leva de 1 a 2 s pra compilá-los em máquinas mais antigas.
// Chamando o gerador direto, a página inteira fica parada esse tempo - na tela
// de login, bem quando a pessoa começa a digitar. Aqui a compilação é pedida
// antes, em segundo plano (extensão KHR_parallel_shader_compile), e o mapa só
// é gerado quando os shaders estão prontos.
//
// Os passos de pré-compilação usam partes internas do PMREMGenerator (three
// r186). Se uma versão futura mudar esses nomes, nada quebra: a função cai no
// caminho normal, que funciona igual, só que segurando a página.

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Gera o mapa de reflexos a partir de uma textura equirretangular.
 * Devolve o WebGLRenderTarget (use .texture em scene.environment e faça
 * dispose() no fim), ou null se `isStopped()` virar true no meio da espera.
 */
export async function prefilterEnvironment(THREE, renderer, equirect, isStopped = () => false) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    if (pmrem._setSize && pmrem._allocateTargets && renderer.properties) {
      pmrem._setSize(equirect.image.width / 4);
      const warmup = pmrem._allocateTargets(); // cria os shaders dos filtros
      pmrem.compileEquirectangularShader();     // cria o shader de leitura da textura
      const materials = [pmrem._equirectMaterial, pmrem._ggxMaterial].filter(Boolean);
      // O programa só é reaproveitado se for compilado na mesma configuração
      // do uso de verdade: com um alvo de renderização ativo e numa malha que
      // tenha o atributo de posição (o pré-compilador do próprio three usa
      // uma malha vazia, e aí o programa é compilado de novo na hora de usar)
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      const camera = new THREE.OrthographicCamera();
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(warmup);
      materials.forEach((material) => renderer.compile(new THREE.Mesh(geometry, material), camera));
      renderer.setRenderTarget(previous);
      warmup.dispose();
      geometry.dispose();

      const compiled = () => materials.every((material) => {
        const program = renderer.properties.get(material).currentProgram;
        return !program || program.isReady();
      });
      for (let i = 0; i < 400 && !compiled(); i += 1) {
        await pause(16);
        if (isStopped()) break;
      }
    }
  } catch (error) {
    // API interna diferente da esperada: segue pelo caminho normal
  }
  if (isStopped()) {
    pmrem.dispose();
    return null;
  }
  const target = pmrem.fromEquirectangular(equirect);
  pmrem.dispose();
  return target;
}

/**
 * Ambiente de "estúdio" pros modelos soltos (tanque, mini-pátio): teto claro,
 * paredes neutras, piso mais escuro e três painéis de luz suave - o bastante
 * pra vidro, aço e tinta terem o que refletir. Devolve um canvas
 * equirretangular (use numa CanvasTexture com EquirectangularReflectionMapping).
 */
export function studioCanvas() {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#ffffff');
  wall.addColorStop(0.3, '#e4e9ee');
  wall.addColorStop(0.5, '#aeb6bd');
  wall.addColorStop(0.62, '#6b7279');
  wall.addColorStop(1, '#44494e');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // Painéis de luz suave espalhados em volta
  [[0.12, 0.3, 0.1], [0.42, 0.24, 0.13], [0.78, 0.32, 0.09]].forEach(([u, v, size]) => {
    [-1, 0, 1].forEach((wrap) => {
      const r = size * w;
      ctx.save();
      ctx.translate((u + wrap) * w, v * h);
      ctx.scale(1, 0.55);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    });
  });
  return canvas;
}
