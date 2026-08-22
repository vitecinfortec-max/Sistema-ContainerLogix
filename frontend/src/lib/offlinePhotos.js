// Armazenamento local de fotos para o app Android offline. Guarda arquivos em
// Directory.Data/photos/<caminho relativo> — o mesmo <caminho relativo> é usado
// como chave em container_photos/photos[].url no SQLite e como caminho dentro da
// pasta "uploads/" do backup portátil (ver offlineBackup.js), para que copiar os
// bytes entre um lado e outro seja sempre uma cópia 1:1 direta.
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

const PHOTOS_SUBDIR = 'photos';

export async function capturePhoto(useCamera) {
  const photo = await Camera.getPhoto({
    quality: 80,
    resultType: CameraResultType.Base64,
    source: useCamera ? CameraSource.Camera : CameraSource.Photos,
  });
  return { base64: photo.base64String, ext: photo.format || 'jpeg' };
}

export async function savePhotoBase64(relativePath, base64Data) {
  await Filesystem.writeFile({
    path: `${PHOTOS_SUBDIR}/${relativePath}`,
    data: base64Data,
    directory: Directory.Data,
    recursive: true,
  });
  return relativePath;
}

export async function deletePhoto(relativePath) {
  if (!relativePath) return;
  try {
    await Filesystem.deleteFile({ path: `${PHOTOS_SUBDIR}/${relativePath}`, directory: Directory.Data });
  } catch (e) {
    // arquivo já pode não existir
  }
}

export async function getPhotoDisplayUri(relativePath) {
  if (!relativePath) return null;
  try {
    const result = await Filesystem.getUri({ path: `${PHOTOS_SUBDIR}/${relativePath}`, directory: Directory.Data });
    return Capacitor.convertFileSrc(result.uri);
  } catch (e) {
    return null;
  }
}

export async function readPhotoBase64(relativePath) {
  const result = await Filesystem.readFile({ path: `${PHOTOS_SUBDIR}/${relativePath}`, directory: Directory.Data });
  return result.data;
}

export async function listAllPhotoRelativePaths() {
  const paths = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await Filesystem.readdir({ path: dir, directory: Directory.Data });
    } catch (e) {
      return;
    }
    for (const entry of entries.files) {
      const entryPath = `${dir}/${entry.name}`;
      if (entry.type === 'directory') {
        await walk(entryPath);
      } else {
        paths.push(entryPath.substring(PHOTOS_SUBDIR.length + 1));
      }
    }
  }
  await walk(PHOTOS_SUBDIR);
  return paths;
}

export const PHOTOS_SUBDIR_NAME = PHOTOS_SUBDIR;
