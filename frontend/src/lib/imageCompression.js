// Comprime uma foto no navegador antes do upload - fotos de câmera de celular
// costumam vir com vários MB (3000-4000px de lado), e isso era enviado pro
// servidor sem nenhum redimensionamento, uma foto de cada vez - com várias
// fotos por vistoria, o salvamento ficava lento, principalmente em rede
// móvel. Reduz pra no máximo 1600px no lado maior e reencoda como JPEG.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
const SKIP_COMPRESSION_BELOW_BYTES = 300 * 1024; // já pequena, não vale a pena reprocessar

export function compressImage(file, options = {}) {
  const maxDimension = options.maxDimension || MAX_DIMENSION;
  const quality = options.quality ?? JPEG_QUALITY;

  if (!file || !file.type?.startsWith('image/') || file.size < SKIP_COMPRESSION_BELOW_BYTES) {
    return Promise.resolve(file);
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    const fallback = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) {
          // Compressão não ajudou (raro, ex: imagem já bem comprimida) - mantém original.
          resolve(file);
          return;
        }
        const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        resolve(new File([blob], compressedName, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };

    img.onerror = fallback;
    img.src = url;
  });
}
