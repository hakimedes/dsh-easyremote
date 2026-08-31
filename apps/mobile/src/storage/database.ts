import * as SQLite from 'expo-sqlite';
import type { Node, SessionSummary, SessionView, User } from '../domain/types';

type CacheDatabase = ReturnType<typeof SQLite.openDatabaseSync>;

let database: CacheDatabase | undefined;

function db() {
  if (!database) {
    database = SQLite.openDatabaseSync('dsh-mobile.db');
    database.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS user_cache (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        org_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS node_cache (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_cache (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_snapshot_cache (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        last_source_seq INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_cache_node_idx ON session_cache(node_id);
    `);
  }
  return database;
}

export function readAppPreference(key: string) {
  const row = db().getFirstSync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', [key]);
  return row?.value || null;
}

export function writeAppPreference(key: string, value: string) {
  db().runSync(
    'INSERT OR REPLACE INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)',
    [key, value, Date.now()],
  );
}

export function readGenuiFormState(key: string): Record<string, string | boolean | number> {
  const value = readAppPreference(`genui-form:${key}`);
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string | boolean | number> = {};
    for (const [field, item] of Object.entries(parsed as Record<string, unknown>).slice(0, 100)) {
      if (typeof item === 'string') result[field.slice(0, 200)] = item.slice(0, 2_000);
      else if (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) result[field.slice(0, 200)] = item;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeGenuiFormState(key: string, value: Record<string, string | boolean | number>) {
  writeAppPreference(`genui-form:${key}`, JSON.stringify(value));
}

export function cacheUser(user: User) {
  db().runSync(
    'INSERT OR REPLACE INTO user_cache (id, display_name, org_id, updated_at) VALUES (?, ?, ?, ?)',
    [user.id, user.displayName, user.orgId, Date.now()],
  );
}

export function readCachedUser(): User | null {
  const row = db().getFirstSync<{ id: string; display_name: string; org_id: string }>('SELECT * FROM user_cache LIMIT 1');
  return row ? { id: row.id, displayName: row.display_name, orgId: row.org_id } : null;
}

export function cacheNodes(nodes: Node[]) {
  const statement = db().prepareSync('INSERT OR REPLACE INTO node_cache (id, payload, updated_at) VALUES (?, ?, ?)');
  try {
    for (const node of nodes) statement.executeSync([node.id, JSON.stringify(node), Date.now()]);
  } finally {
    statement.finalizeSync();
  }
}

export function readCachedNodes() {
  const rows = db().getAllSync<{ payload: string }>('SELECT payload FROM node_cache ORDER BY updated_at DESC');
  return rows.map((row) => JSON.parse(row.payload) as Node);
}

export function cacheSessions(nodeId: string, sessions: SessionSummary[]) {
  const statement = db().prepareSync('INSERT OR REPLACE INTO session_cache (id, node_id, payload, updated_at) VALUES (?, ?, ?, ?)');
  try {
    for (const session of sessions) statement.executeSync([`${nodeId}:${session.sessionId}`, nodeId, JSON.stringify(session), Date.now()]);
  } finally {
    statement.finalizeSync();
  }
}

export function readCachedSessions(nodeId: string) {
  const rows = db().getAllSync<{ payload: string }>('SELECT payload FROM session_cache WHERE node_id = ? ORDER BY updated_at DESC', [nodeId]);
  return rows.map((row) => JSON.parse(row.payload) as SessionSummary);
}

export function cacheSessionView(view: SessionView) {
  db().runSync(
    `INSERT OR REPLACE INTO session_snapshot_cache (id, node_id, session_id, payload, last_source_seq, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      `${view.session.nodeId}:${view.session.sessionId}`,
      view.session.nodeId,
      view.session.sessionId,
      JSON.stringify(view),
      view.lastSourceSeq,
      Date.now(),
    ],
  );
}

export function readCachedSessionView(nodeId: string, sessionId: string) {
  const row = db().getFirstSync<{ payload: string }>('SELECT payload FROM session_snapshot_cache WHERE id = ?', [`${nodeId}:${sessionId}`]);
  return row ? (JSON.parse(row.payload) as SessionView) : null;
}
