import { CLEANUP_BATCH, fail, MAX_RECORDS } from './core.mjs';

const KINDS = new Set(['oauth', 'ticket', 'bootstrap', 'challenge', 'session']);

// This database is authentication-only. Vault bodies never enter these methods.
export class AuthStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS auth_records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (kind, key))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS auth_expiry ON auth_records (expires_at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS auth_owner (id INTEGER PRIMARY KEY CHECK (id = 1), credential TEXT NOT NULL, salt TEXT NOT NULL)');
  }
  checkKind(kind) { if (!KINDS.has(kind)) fail(503); }
  get(kind, key, now) {
    this.checkKind(kind);
    const rows = this.sql.exec('SELECT value, expires_at FROM auth_records WHERE kind = ? AND key = ?', kind, key).toArray();
    if (!rows.length) return null;
    if (now >= rows[0].expires_at) { this.remove(kind, key); return null; }
    return { value: JSON.parse(rows[0].value), expiresAt: rows[0].expires_at };
  }
  put(kind, key, value, expiresAt) {
    this.checkKind(kind);
    this.storage.transactionSync(() => {
      const exists = this.sql.exec('SELECT 1 FROM auth_records WHERE kind = ? AND key = ?', kind, key).toArray().length > 0;
      const count = this.sql.exec('SELECT COUNT(*) AS count FROM auth_records').one().count;
      if (!exists && count >= MAX_RECORDS) fail(429);
      this.sql.exec('INSERT INTO auth_records (kind, key, value, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at', kind, key, JSON.stringify(value), expiresAt);
    });
  }
  remove(kind, key) {
    this.checkKind(kind);
    this.sql.exec('DELETE FROM auth_records WHERE kind = ? AND key = ?', kind, key);
  }
  take(kind, key, now, predicate = () => true) {
    return this.storage.transactionSync(() => {
      const record = this.get(kind, key, now);
      if (!record || !predicate(record.value)) return null;
      this.remove(kind, key);
      return record;
    });
  }
  purge(now, limit = CLEANUP_BATCH) {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM auth_records WHERE (kind, key) IN (SELECT kind, key FROM auth_records WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)', now, limit);
    });
  }
  nextExpiry() { return this.sql.exec('SELECT MIN(expires_at) AS expires_at FROM auth_records').one().expires_at; }
  credential() {
    const rows = this.sql.exec('SELECT credential, salt FROM auth_owner WHERE id = 1').toArray();
    return rows.length ? { credential: JSON.parse(rows[0].credential), salt: rows[0].salt } : null;
  }
  enroll(credential, salt) {
    return this.storage.transactionSync(() => {
      if (this.credential()) return false;
      this.sql.exec('INSERT INTO auth_owner (id, credential, salt) VALUES (1, ?, ?)', JSON.stringify(credential), salt);
      return true;
    });
  }
  updateCounter(id, counter) {
    this.storage.transactionSync(() => {
      const enrolled = this.credential();
      if (!enrolled || enrolled.credential.id !== id) fail(401);
      enrolled.credential.counter = counter;
      this.sql.exec('UPDATE auth_owner SET credential = ? WHERE id = 1', JSON.stringify(enrolled.credential));
    });
  }
}
