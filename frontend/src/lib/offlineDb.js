// Camada de dados local para o app Android offline (sem servidor, sem MongoDB).
// Usa @capacitor-community/sqlite. Os nomes de tabela e de coluna espelham as
// coleções/campos do backend (backend/models.py) de propósito, para que o
// formato de backup portátil (ver offlineBackup.js e
// backend/export_portable_backup.py) seja uma simples cópia 1:1 de linhas.
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'containerlogix_offline';

const sqlite = new SQLiteConnection(CapacitorSQLite);
let db = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS transport_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS shipping_lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS container_movements (
  id TEXT PRIMARY KEY,
  transaction_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  driver_name TEXT,
  driver_cpf TEXT,
  truck_plate TEXT,
  trailer_plate_1 TEXT,
  trailer_plate_2 TEXT,
  transport_company TEXT,
  client_name TEXT,
  container_number TEXT NOT NULL,
  status TEXT NOT NULL,
  size_type TEXT NOT NULL,
  tare TEXT,
  shipping_line TEXT,
  seal TEXT,
  genset TEXT,
  booking TEXT,
  service_type TEXT,
  invoice_number TEXT,
  service_value REAL,
  currency TEXT DEFAULT 'BRL',
  observations TEXT,
  container_photos TEXT,
  container_damages TEXT,
  billed INTEGER DEFAULT 0,
  billed_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  user_name TEXT
);

CREATE TABLE IF NOT EXISTS container_inspections (
  id TEXT PRIMARY KEY,
  inspection_number INTEGER NOT NULL,
  container_number TEXT NOT NULL,
  container_seal TEXT,
  size_type TEXT,
  collection_terminal TEXT,
  booking TEXT,
  client_id TEXT,
  client_name TEXT,
  shipping_line_id TEXT,
  shipping_line_name TEXT,
  observations TEXT,
  no_damage INTEGER DEFAULT 0,
  damage_items TEXT,
  photos TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

export async function initOfflineDb() {
  if (db) return db;

  const consistency = await sqlite.checkConnectionsConsistency();
  const alreadyOpen = (await sqlite.isConnection(DB_NAME, false)).result;

  if (consistency.result && alreadyOpen) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  }

  await db.open();
  await db.execute(SCHEMA_SQL);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function nextSequence(name) {
  await db.run(
    `INSERT INTO local_counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`,
    [name]
  );
  const res = await db.query('SELECT value FROM local_counters WHERE name = ?', [name]);
  return res.values[0].value;
}

async function listAll(table, orderBy = 'created_at DESC') {
  await initOfflineDb();
  const res = await db.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  return res.values || [];
}

async function getById(table, id) {
  await initOfflineDb();
  const res = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return (res.values || [])[0] || null;
}

async function removeById(table, id) {
  await initOfflineDb();
  await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

// ---- Cadastros básicos ----

export const offlineDrivers = {
  list: () => listAll('drivers', 'name ASC'),
  create: async ({ name, cpf, phone }) => {
    await initOfflineDb();
    const row = { id: newId(), name, cpf, phone: phone || null, created_at: nowIso(), created_by: 'offline' };
    await db.run(
      'INSERT INTO drivers (id, name, cpf, phone, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.name, row.cpf, row.phone, row.created_at, row.created_by]
    );
    return row;
  },
  update: async (id, { name, cpf, phone }) => {
    await initOfflineDb();
    await db.run('UPDATE drivers SET name = ?, cpf = ?, phone = ? WHERE id = ?', [name, cpf, phone || null, id]);
  },
  remove: (id) => removeById('drivers', id),
};

export const offlineTransportCompanies = {
  list: () => listAll('transport_companies', 'name ASC'),
  create: async ({ name, cnpj, phone }) => {
    await initOfflineDb();
    const row = { id: newId(), name, cnpj: cnpj || null, phone: phone || null, created_at: nowIso(), created_by: 'offline' };
    await db.run(
      'INSERT INTO transport_companies (id, name, cnpj, phone, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.name, row.cnpj, row.phone, row.created_at, row.created_by]
    );
    return row;
  },
  update: async (id, { name, cnpj, phone }) => {
    await initOfflineDb();
    await db.run('UPDATE transport_companies SET name = ?, cnpj = ?, phone = ? WHERE id = ?', [name, cnpj || null, phone || null, id]);
  },
  remove: (id) => removeById('transport_companies', id),
};

export const offlineClients = {
  list: () => listAll('clients', 'name ASC'),
  create: async ({ name, cnpj, phone, email, address }) => {
    await initOfflineDb();
    const row = {
      id: newId(), name, cnpj: cnpj || null, phone: phone || null, email: email || null,
      address: address || null, created_at: nowIso(), created_by: 'offline',
    };
    await db.run(
      'INSERT INTO clients (id, name, cnpj, phone, email, address, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.id, row.name, row.cnpj, row.phone, row.email, row.address, row.created_at, row.created_by]
    );
    return row;
  },
  update: async (id, { name, cnpj, phone, email, address }) => {
    await initOfflineDb();
    await db.run(
      'UPDATE clients SET name = ?, cnpj = ?, phone = ?, email = ?, address = ? WHERE id = ?',
      [name, cnpj || null, phone || null, email || null, address || null, id]
    );
  },
  remove: (id) => removeById('clients', id),
};

export const offlineShippingLines = {
  list: () => listAll('shipping_lines', 'name ASC'),
  create: async ({ name, code }) => {
    await initOfflineDb();
    const row = { id: newId(), name, code: code || null, created_at: nowIso(), created_by: 'offline' };
    await db.run(
      'INSERT INTO shipping_lines (id, name, code, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
      [row.id, row.name, row.code, row.created_at, row.created_by]
    );
    return row;
  },
  update: async (id, { name, code }) => {
    await initOfflineDb();
    await db.run('UPDATE shipping_lines SET name = ?, code = ? WHERE id = ?', [name, code || null, id]);
  },
  remove: (id) => removeById('shipping_lines', id),
};

// ---- Movimentação de Containers ----

function rowToMovement(row) {
  if (!row) return null;
  return {
    ...row,
    container_photos: row.container_photos ? JSON.parse(row.container_photos) : null,
    container_damages: row.container_damages ? JSON.parse(row.container_damages) : [],
    billed: !!row.billed,
  };
}

export const offlineMovements = {
  list: async () => (await listAll('container_movements')).map(rowToMovement),
  get: async (id) => rowToMovement(await getById('container_movements', id)),
  create: async (data) => {
    await initOfflineDb();
    const row = {
      id: newId(),
      transaction_id: await nextSequence('container_movements'),
      operation_type: data.operation_type,
      driver_name: data.driver_name || null,
      driver_cpf: data.driver_cpf || null,
      truck_plate: data.truck_plate || null,
      trailer_plate_1: data.trailer_plate_1 || null,
      trailer_plate_2: data.trailer_plate_2 || null,
      transport_company: data.transport_company || null,
      client_name: data.client_name || null,
      container_number: data.container_number,
      status: data.status,
      size_type: data.size_type,
      tare: data.tare || null,
      shipping_line: data.shipping_line || null,
      seal: data.seal || null,
      genset: data.genset || null,
      booking: data.booking || null,
      service_type: data.service_type || null,
      invoice_number: data.invoice_number || null,
      service_value: data.service_value ?? null,
      currency: data.currency || 'BRL',
      observations: data.observations || null,
      container_photos: data.container_photos ? JSON.stringify(data.container_photos) : null,
      container_damages: JSON.stringify(data.container_damages || []),
      billed: 0,
      billed_at: null,
      created_at: nowIso(),
      created_by: 'offline',
      user_name: 'Offline',
    };
    await db.run(
      `INSERT INTO container_movements (
        id, transaction_id, operation_type, driver_name, driver_cpf, truck_plate,
        trailer_plate_1, trailer_plate_2, transport_company, client_name, container_number,
        status, size_type, tare, shipping_line, seal, genset, booking, service_type,
        invoice_number, service_value, currency, observations, container_photos,
        container_damages, billed, billed_at, created_at, created_by, user_name
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.transaction_id, row.operation_type, row.driver_name, row.driver_cpf, row.truck_plate,
        row.trailer_plate_1, row.trailer_plate_2, row.transport_company, row.client_name, row.container_number,
        row.status, row.size_type, row.tare, row.shipping_line, row.seal, row.genset, row.booking, row.service_type,
        row.invoice_number, row.service_value, row.currency, row.observations, row.container_photos,
        row.container_damages, row.billed, row.billed_at, row.created_at, row.created_by, row.user_name,
      ]
    );
    return rowToMovement(row);
  },
  update: async (id, data) => {
    await initOfflineDb();
    await db.run(
      `UPDATE container_movements SET
        operation_type=?, driver_name=?, driver_cpf=?, truck_plate=?, trailer_plate_1=?, trailer_plate_2=?,
        transport_company=?, client_name=?, container_number=?, status=?, size_type=?, tare=?, shipping_line=?,
        seal=?, genset=?, booking=?, service_type=?, invoice_number=?, service_value=?, currency=?, observations=?,
        container_photos=?, container_damages=?
       WHERE id=?`,
      [
        data.operation_type, data.driver_name || null, data.driver_cpf || null, data.truck_plate || null,
        data.trailer_plate_1 || null, data.trailer_plate_2 || null, data.transport_company || null,
        data.client_name || null, data.container_number, data.status, data.size_type, data.tare || null,
        data.shipping_line || null, data.seal || null, data.genset || null, data.booking || null,
        data.service_type || null, data.invoice_number || null, data.service_value ?? null,
        data.currency || 'BRL', data.observations || null,
        data.container_photos ? JSON.stringify(data.container_photos) : null,
        JSON.stringify(data.container_damages || []),
        id,
      ]
    );
  },
  remove: (id) => removeById('container_movements', id),
};

// ---- Vistoria de Container ----

function rowToInspection(row) {
  if (!row) return null;
  return {
    ...row,
    damage_items: row.damage_items ? JSON.parse(row.damage_items) : [],
    photos: row.photos ? JSON.parse(row.photos) : [],
    no_damage: !!row.no_damage,
  };
}

export const offlineInspections = {
  list: async () => (await listAll('container_inspections')).map(rowToInspection),
  get: async (id) => rowToInspection(await getById('container_inspections', id)),
  create: async (data) => {
    await initOfflineDb();
    const row = {
      id: data.id || newId(),
      inspection_number: await nextSequence('container_inspections'),
      container_number: data.container_number,
      container_seal: data.container_seal || null,
      size_type: data.size_type || null,
      collection_terminal: data.collection_terminal || null,
      booking: data.booking || null,
      client_id: data.client_id || null,
      client_name: data.client_name || null,
      shipping_line_id: data.shipping_line_id || null,
      shipping_line_name: data.shipping_line_name || null,
      observations: data.observations || null,
      no_damage: data.no_damage ? 1 : 0,
      damage_items: JSON.stringify(data.damage_items || []),
      photos: JSON.stringify(data.photos || []),
      created_by: 'offline',
      created_by_name: 'Offline',
      created_at: nowIso(),
      updated_at: null,
    };
    await db.run(
      `INSERT INTO container_inspections (
        id, inspection_number, container_number, container_seal, size_type, collection_terminal,
        booking, client_id, client_name, shipping_line_id, shipping_line_name, observations,
        no_damage, damage_items, photos, created_by, created_by_name, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.inspection_number, row.container_number, row.container_seal, row.size_type,
        row.collection_terminal, row.booking, row.client_id, row.client_name, row.shipping_line_id,
        row.shipping_line_name, row.observations, row.no_damage, row.damage_items, row.photos,
        row.created_by, row.created_by_name, row.created_at, row.updated_at,
      ]
    );
    return rowToInspection(row);
  },
  update: async (id, data) => {
    await initOfflineDb();
    await db.run(
      `UPDATE container_inspections SET
        container_number=?, container_seal=?, size_type=?, collection_terminal=?, booking=?,
        client_id=?, client_name=?, shipping_line_id=?, shipping_line_name=?, observations=?,
        no_damage=?, damage_items=?, updated_at=?
       WHERE id=?`,
      [
        data.container_number, data.container_seal || null, data.size_type || null,
        data.collection_terminal || null, data.booking || null, data.client_id || null,
        data.client_name || null, data.shipping_line_id || null, data.shipping_line_name || null,
        data.observations || null, data.no_damage ? 1 : 0, JSON.stringify(data.damage_items || []),
        nowIso(), id,
      ]
    );
  },
  setPhotos: async (id, photos) => {
    await initOfflineDb();
    await db.run('UPDATE container_inspections SET photos = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(photos || []), nowIso(), id,
    ]);
  },
  remove: (id) => removeById('container_inspections', id),
};

// ---- Backup portátil (offlineBackup.js) ----
// Acesso direto às tabelas em formato bruto (linhas ainda não convertidas para
// objeto), para espelhar 1:1 o formato JSON do backup gerado tanto pelo Android
// quanto pelo Windows (backend/export_portable_backup.py).
export async function getRawTable(table) {
  return listAll(table, 'created_at ASC');
}

const IMPORTERS = {
  drivers: {
    insertSql: 'INSERT INTO drivers (id, name, cpf, phone, created_at, created_by) VALUES (?,?,?,?,?,?)',
    toParams: (d) => [d.id, d.name, d.cpf, d.phone ?? null, d.created_at, d.created_by ?? null],
  },
  transport_companies: {
    insertSql: 'INSERT INTO transport_companies (id, name, cnpj, phone, created_at, created_by) VALUES (?,?,?,?,?,?)',
    toParams: (d) => [d.id, d.name, d.cnpj ?? null, d.phone ?? null, d.created_at, d.created_by ?? null],
  },
  clients: {
    insertSql: 'INSERT INTO clients (id, name, cnpj, phone, email, address, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
    toParams: (d) => [d.id, d.name, d.cnpj ?? null, d.phone ?? null, d.email ?? null, d.address ?? null, d.created_at, d.created_by ?? null],
  },
  shipping_lines: {
    insertSql: 'INSERT INTO shipping_lines (id, name, code, created_at, created_by) VALUES (?,?,?,?,?)',
    toParams: (d) => [d.id, d.name, d.code ?? null, d.created_at, d.created_by ?? null],
  },
  container_movements: {
    insertSql: `INSERT INTO container_movements (
        id, transaction_id, operation_type, driver_name, driver_cpf, truck_plate,
        trailer_plate_1, trailer_plate_2, transport_company, client_name, container_number,
        status, size_type, tare, shipping_line, seal, genset, booking, service_type,
        invoice_number, service_value, currency, observations, container_photos,
        container_damages, billed, billed_at, created_at, created_by, user_name
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    toParams: (d) => [
      d.id, d.transaction_id, d.operation_type, d.driver_name ?? null, d.driver_cpf ?? null, d.truck_plate ?? null,
      d.trailer_plate_1 ?? null, d.trailer_plate_2 ?? null, d.transport_company ?? null, d.client_name ?? null,
      d.container_number, d.status, d.size_type, d.tare ?? null, d.shipping_line ?? null, d.seal ?? null,
      d.genset ?? null, d.booking ?? null, d.service_type ?? null, d.invoice_number ?? null,
      d.service_value ?? null, d.currency || 'BRL', d.observations ?? null,
      d.container_photos ? JSON.stringify(d.container_photos) : null,
      JSON.stringify(d.container_damages || []), d.billed ? 1 : 0, d.billed_at ?? null,
      d.created_at, d.created_by ?? null, d.user_name ?? null,
    ],
  },
  container_inspections: {
    insertSql: `INSERT INTO container_inspections (
        id, inspection_number, container_number, container_seal, size_type, collection_terminal,
        booking, client_id, client_name, shipping_line_id, shipping_line_name, observations,
        no_damage, damage_items, photos, created_by, created_by_name, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    toParams: (d) => [
      d.id, d.inspection_number, d.container_number, d.container_seal ?? null, d.size_type ?? null,
      d.collection_terminal ?? null, d.booking ?? null, d.client_id ?? null, d.client_name ?? null,
      d.shipping_line_id ?? null, d.shipping_line_name ?? null, d.observations ?? null,
      d.no_damage ? 1 : 0, JSON.stringify(d.damage_items || []), JSON.stringify(d.photos || []),
      d.created_by ?? null, d.created_by_name ?? null, d.created_at, d.updated_at ?? null,
    ],
  },
};

// Substitui todo o conteúdo das tabelas pelas coleções vindas de um backup
// portátil (import). `collections` = { drivers: [...], container_movements: [...], ... }.
// É uma operação destrutiva: os dados atuais dessas tabelas são descartados.
export async function importCollections(collections) {
  await initOfflineDb();

  for (const table of Object.keys(IMPORTERS)) {
    const docs = collections[table] || [];
    const { insertSql, toParams } = IMPORTERS[table];
    await db.run(`DELETE FROM ${table}`);
    for (const doc of docs) {
      await db.run(insertSql, toParams(doc));
    }
  }

  const maxTransactionId = Math.max(0, ...(collections.container_movements || []).map((d) => d.transaction_id || 0));
  const maxInspectionNumber = Math.max(0, ...(collections.container_inspections || []).map((d) => d.inspection_number || 0));
  await db.run(
    `INSERT INTO local_counters (name, value) VALUES ('container_movements', ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
    [maxTransactionId]
  );
  await db.run(
    `INSERT INTO local_counters (name, value) VALUES ('container_inspections', ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
    [maxInspectionNumber]
  );
}
