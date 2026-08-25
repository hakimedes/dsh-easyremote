import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 19;

type Migration = {
  version: number;
  name: string;
  up: (database: DatabaseSync) => void;
};

const baseSchema = `
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE(token_hash),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (device_id) REFERENCES devices(id)
  );

  CREATE TABLE IF NOT EXISTS node_pairings (
    id TEXT PRIMARY KEY,
    node_id TEXT,
    pair_token_hash TEXT NOT NULL,
    poll_token_hash TEXT NOT NULL,
    install_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    plugin_version TEXT NOT NULL,
    dsh_version TEXT NOT NULL,
    node_secret_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_user_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER,
    UNIQUE(pair_token_hash),
    UNIQUE(poll_token_hash)
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    install_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    plugin_version TEXT NOT NULL,
    dsh_version TEXT NOT NULL,
    credential_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (org_id) REFERENCES organizations(id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS session_index (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    last_event_seq INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(node_id, session_id),
    FOREIGN KEY (node_id) REFERENCES nodes(id)
  );

  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    session_id TEXT,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    acked_at INTEGER,
    error_code TEXT,
    result_json TEXT,
    UNIQUE(user_id, request_id),
    FOREIGN KEY (node_id) REFERENCES nodes(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    request_payload TEXT NOT NULL,
    response TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (node_id) REFERENCES nodes(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    actor_user_id TEXT,
    node_id TEXT,
    device_id TEXT,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS nodes_owner_idx ON nodes(owner_user_id);
  CREATE INDEX IF NOT EXISTS session_index_node_idx ON session_index(node_id);
  CREATE INDEX IF NOT EXISTS pairing_status_idx ON node_pairings(status, created_at);
  CREATE INDEX IF NOT EXISTS command_node_idx ON commands(node_id);
`;

const migrations: Migration[] = [
  {
    version: 1,
    name: 'baseline-schema',
    up(database) {
      database.exec(baseSchema);
    },
  },
  {
    version: 2,
    name: 'command-idempotency-result',
    up(database) {
      const columns = database.prepare('PRAGMA table_info(commands)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'result_json')) {
        database.exec('ALTER TABLE commands ADD COLUMN result_json TEXT');
      }
    },
  },
  {
    version: 3,
    name: 'stable-hub-identity',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS hub_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    name: 'privacy-safe-command-results',
    up(database) {
      database.exec(`
        UPDATE commands
        SET result_json = NULL
        WHERE action NOT IN ('session.create', 'session.selectModel', 'session.rename');
        CREATE INDEX IF NOT EXISTS command_created_idx ON commands(created_at);
      `);
    },
  },
];

function assertSupportedNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < MINIMUM_NODE_MAJOR || (major === MINIMUM_NODE_MAJOR && minor < MINIMUM_NODE_MINOR)) {
    throw new Error(`DSH EasyRemote requires Node.js ${MINIMUM_NODE_MAJOR}.${MINIMUM_NODE_MINOR} or newer`);
  }
}

function applyMigrations(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const record = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      migration.up(database);
      record.run(migration.version, migration.name, Date.now());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openDatabase(path: string) {
  assertSupportedNodeVersion();
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applyMigrations(database);
  return database;
}

export function getOrCreateHubId(database: DatabaseSync) {
  const existing = database
    .prepare("SELECT value FROM hub_meta WHERE key = 'hub_id'")
    .get() as { value: string } | undefined;
  if (existing?.value) return existing.value;

  const hubId = randomUUID();
  database
    .prepare("INSERT INTO hub_meta (key, value, updated_at) VALUES ('hub_id', ?, ?)")
    .run(hubId, Date.now());
  return hubId;
}

export type HubDatabase = ReturnType<typeof openDatabase>;
