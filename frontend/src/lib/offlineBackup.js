// Gera/importa o backup portátil do app Android offline. Mesmo formato de zip
// (manifest.json + data/<colecao>.json + uploads/<...>) que
// backend/export_portable_backup.py gera a partir do Windows — assim um backup
// gerado no Windows pode ser copiado para a pasta Documentos do Android e
// importado aqui, e vice-versa.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { getRawTable, importCollections } from './offlineDb';
import { readPhotoBase64, savePhotoBase64 } from './offlinePhotos';

const BACKUP_DIR = 'ContainerLogix-Backups';
const FORMAT_NAME = 'containerlogix-portable-backup';
const COLLECTIONS = [
  'drivers',
  'transport_companies',
  'clients',
  'shipping_lines',
  'container_movements',
  'container_inspections',
];

function base64ToU8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function u8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function rowsToPlainDocs(table, rows) {
  return rows.map((row) => {
    const doc = { ...row };
    if (table === 'container_movements') {
      doc.container_photos = row.container_photos ? JSON.parse(row.container_photos) : null;
      doc.container_damages = row.container_damages ? JSON.parse(row.container_damages) : [];
      doc.billed = !!row.billed;
    }
    if (table === 'container_inspections') {
      doc.damage_items = row.damage_items ? JSON.parse(row.damage_items) : [];
      doc.photos = row.photos ? JSON.parse(row.photos) : [];
      doc.no_damage = !!row.no_damage;
    }
    return doc;
  });
}

function collectUploadRefs(table, doc) {
  if (table === 'container_movements') {
    return Object.values(doc.container_photos || {}).filter(Boolean);
  }
  if (table === 'container_inspections') {
    return (doc.photos || []).map((p) => p && p.url).filter(Boolean);
  }
  return [];
}

export async function exportBackup() {
  const files = {};
  const counts = {};
  const uploadRefs = new Set();
  const collectionsForZip = {};

  for (const table of COLLECTIONS) {
    const rawRows = await getRawTable(table);
    const docs = rowsToPlainDocs(table, rawRows);
    collectionsForZip[table] = docs;
    counts[table] = docs.length;
    files[`data/${table}.json`] = strToU8(JSON.stringify(docs));
    for (const doc of docs) {
      for (const ref of collectUploadRefs(table, doc)) uploadRefs.add(ref);
    }
  }

  let copied = 0;
  let missing = 0;
  for (const ref of uploadRefs) {
    try {
      const base64 = await readPhotoBase64(ref);
      files[`uploads/${ref}`] = base64ToU8(base64);
      copied += 1;
    } catch (e) {
      missing += 1;
    }
  }

  const manifest = {
    format: FORMAT_NAME,
    version: 1,
    generated_at: new Date().toISOString(),
    source_platform: 'android',
    collections: counts,
    uploads_copied: copied,
    uploads_missing: missing,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files, { level: 6 });
  const zipBase64 = u8ToBase64(zipped);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `containerlogix-backup-android-${timestamp}.zip`;

  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${fileName}`,
    data: zipBase64,
    directory: Directory.Documents,
    recursive: true,
  });

  return { fileName, manifest };
}

export async function listAvailableBackups() {
  try {
    const res = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents });
    return res.files
      .filter((f) => f.name.toLowerCase().endsWith('.zip'))
      .map((f) => f.name)
      .sort()
      .reverse();
  } catch (e) {
    return [];
  }
}

export async function importBackup(fileName) {
  const { data: zipBase64 } = await Filesystem.readFile({
    path: `${BACKUP_DIR}/${fileName}`,
    directory: Directory.Documents,
  });

  const unzipped = unzipSync(base64ToU8(zipBase64));

  const manifestBytes = unzipped['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Arquivo de backup inválido: manifest.json não encontrado.');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes));
  if (manifest.format !== FORMAT_NAME) {
    throw new Error('Este arquivo não é um backup válido do ContainerLogix.');
  }

  const collections = {};
  for (const table of COLLECTIONS) {
    const bytes = unzipped[`data/${table}.json`];
    collections[table] = bytes ? JSON.parse(strFromU8(bytes)) : [];
  }

  let photosRestored = 0;
  for (const [path, bytes] of Object.entries(unzipped)) {
    if (!path.startsWith('uploads/')) continue;
    const relativePath = path.substring('uploads/'.length);
    if (!relativePath) continue;
    await savePhotoBase64(relativePath, u8ToBase64(bytes));
    photosRestored += 1;
  }

  await importCollections(collections);

  return { manifest, photosRestored };
}
