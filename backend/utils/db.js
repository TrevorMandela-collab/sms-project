/* =========================================================
   Simple JSON-file data store.
   Each "collection" (students, teachers, etc.) lives in its
   own file under /data. This keeps the backend dependency-free
   (no native DB compilation) while giving you real persistence
   and a real REST API on top. Swap this module for a Postgres/
   MySQL layer later without touching your route files, as long
   as you keep the same function signatures.
========================================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function filePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function ensureFile(collection, seedData = []) {
  const file = filePath(collection);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(seedData, null, 2));
}

function readAll(collection) {
  ensureFile(collection);
  const raw = fs.readFileSync(filePath(collection), 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(collection, records) {
  ensureFile(collection);
  fs.writeFileSync(filePath(collection), JSON.stringify(records, null, 2));
}

function findById(collection, id) {
  return readAll(collection).find(r => r.id === id) || null;
}

function insert(collection, record) {
  const records = readAll(collection);
  records.unshift(record);
  writeAll(collection, records);
  return record;
}

function update(collection, id, updates) {
  const records = readAll(collection);
  const index = records.findIndex(r => r.id === id);
  if (index === -1) return null;
  records[index] = { ...records[index], ...updates, id };
  writeAll(collection, records);
  return records[index];
}

function remove(collection, id) {
  const records = readAll(collection);
  const filtered = records.filter(r => r.id !== id);
  const removed = filtered.length !== records.length;
  writeAll(collection, filtered);
  return removed;
}

module.exports = { readAll, writeAll, findById, insert, update, remove, ensureFile };
