import { Pool } from 'pg';

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export type PostgresConnectionInput = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
};

export function createPostgresPool(connection: PostgresConnectionInput) {
  return new Pool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });
}

export async function testConnection(connection: PostgresConnectionInput) {
  const pool = createPostgresPool(connection);
  try {
    const res = await pool.query('select version() as version, current_database() as database');
    return {
      version: String(res.rows[0]?.version ?? ''),
      database: String(res.rows[0]?.database ?? connection.database),
    };
  } finally {
    await pool.end();
  }
}

export async function provisionDatabase(input: {
  admin: PostgresConnectionInput;
  databaseName: string;
  ownerUser?: string;
  ownerPassword?: string;
}) {
  const pool = createPostgresPool(input.admin);
  try {
    if (input.ownerUser && input.ownerPassword) {
      const roleExists = await pool.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [input.ownerUser]);
      if (roleExists.rowCount === 0) {
        await pool.query(`CREATE ROLE ${quoteIdent(input.ownerUser)} LOGIN PASSWORD ${quoteLiteral(input.ownerPassword)}`);
      } else {
        await pool.query(`ALTER ROLE ${quoteIdent(input.ownerUser)} WITH LOGIN PASSWORD ${quoteLiteral(input.ownerPassword)}`);
      }
    }

    const exists = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [input.databaseName]);
    if (exists.rowCount === 0) {
      if (input.ownerUser) {
        await pool.query(`CREATE DATABASE ${quoteIdent(input.databaseName)} OWNER ${quoteIdent(input.ownerUser)}`);
      } else {
        await pool.query(`CREATE DATABASE ${quoteIdent(input.databaseName)}`);
      }
    }
  } finally {
    await pool.end();
  }
}

/** Удалить БД на кластере (подключение от имени админа к служебной базе, по умолчанию postgres). */
export async function dropPostgresManagedDatabase(admin: PostgresConnectionInput, databaseName: string, ownerRole?: string) {
  const pool = createPostgresPool(admin);
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
    if (ownerRole?.trim()) {
      try {
        await pool.query(`DROP ROLE IF EXISTS ${quoteIdent(ownerRole.trim())}`);
      } catch {
        /* роль может использоваться иначе */
      }
    }
  } finally {
    await pool.end();
  }
}

export async function listSchema(connection: PostgresConnectionInput) {
  const pool = createPostgresPool(connection);
  try {
    const result = await pool.query(`
      SELECT
        t.table_name AS name,
        COUNT(c.column_name)::int AS columns,
        COALESCE((SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name), 0)::bigint AS rows,
        pg_size_pretty(pg_total_relation_size(format('%I.%I', t.table_schema, t.table_name))) AS size
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      GROUP BY t.table_schema, t.table_name
      ORDER BY t.table_name ASC
    `);

    return result.rows.map((row) => ({
      name: row.name,
      columns: Number(row.columns),
      rows: Number(row.rows),
      size: row.size,
    }));
  } finally {
    await pool.end();
  }
}

export async function getTableData(connection: PostgresConnectionInput, table: string, limit: number, offset: number) {
  const pool = createPostgresPool(connection);
  try {
    const columnsRes = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    const dataRes = await pool.query(`SELECT * FROM ${quoteIdent("public")}.${quoteIdent(table)} LIMIT ${limit} OFFSET ${offset}`);
    return {
      columns: columnsRes.rows.map((row) => row.column_name),
      rows: dataRes.rows,
    };
  } finally {
    await pool.end();
  }
}

export async function runSql(connection: PostgresConnectionInput, sql: string, values: unknown[] = []) {
  const pool = createPostgresPool(connection);
  try {
    const result = await pool.query(sql, values);
    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    };
  } finally {
    await pool.end();
  }
}

export async function insertRow(connection: PostgresConnectionInput, table: string, data: Record<string, unknown>) {
  const pool = createPostgresPool(connection);
  try {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
    const columns = keys.map((key) => quoteIdent(key)).join(', ');
    const query = `INSERT INTO ${quoteIdent("public")}.${quoteIdent(table)} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  } finally {
    await pool.end();
  }
}

export async function updateRow(connection: PostgresConnectionInput, table: string, pkColumn: string, pkValue: unknown, patch: Record<string, unknown>) {
  const pool = createPostgresPool(connection);
  try {
    const keys = Object.keys(patch);
    const values = Object.values(patch);
    const setClause = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`).join(', ');
    const query = `UPDATE ${quoteIdent("public")}.${quoteIdent(table)} SET ${setClause} WHERE ${quoteIdent(pkColumn)} = $${keys.length + 1} RETURNING *`;
    const result = await pool.query(query, [...values, pkValue]);
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

export async function deleteRow(connection: PostgresConnectionInput, table: string, pkColumn: string, pkValue: unknown) {
  const pool = createPostgresPool(connection);
  try {
    const result = await pool.query(`DELETE FROM ${quoteIdent("public")}.${quoteIdent(table)} WHERE ${quoteIdent(pkColumn)} = $1`, [pkValue]);
    return result.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

export async function truncatePublicTable(connection: PostgresConnectionInput, table: string) {
  const pool = createPostgresPool(connection);
  try {
    await pool.query(`TRUNCATE TABLE ${quoteIdent('public')}.${quoteIdent(table)} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}

export async function exportBackupPayload(connection: PostgresConnectionInput) {
  const pool = createPostgresPool(connection);
  try {
    const tables = await listSchema(connection);
    const payload: Record<string, unknown> = { tables: [] as unknown[] };

    for (const table of tables) {
      const columnsRes = await pool.query(
        `SELECT
           a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS pg_type,
           CASE WHEN NOT a.attnotnull THEN 'YES' ELSE 'NO' END AS is_nullable,
           c.data_type AS data_type
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class rel ON a.attrelid = rel.oid
         JOIN pg_catalog.pg_namespace nsp ON rel.relnamespace = nsp.oid
         LEFT JOIN information_schema.columns c
           ON c.table_schema = 'public' AND c.table_name = rel.relname AND c.column_name = a.attname
         WHERE nsp.nspname = 'public'
           AND rel.relname = $1
           AND rel.relkind = 'r'
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [table.name],
      );
      const pkRes = await pool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_schema = kcu.constraint_schema
          AND tc.constraint_name = kcu.constraint_name
         WHERE tc.table_schema = 'public'
           AND tc.table_name = $1
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`,
        [table.name],
      );
      const primaryKeyColumns = pkRes.rows.map((r: { column_name: string }) => String(r.column_name));
      const rowsRes = await pool.query(`SELECT * FROM ${quoteIdent("public")}.${quoteIdent(table.name)}`);
      (payload.tables as any[]).push({
        name: table.name,
        columns: columnsRes.rows,
        primaryKeyColumns,
        rows: rowsRes.rows,
      });
    }

    return payload;
  } finally {
    await pool.end();
  }
}

function inferPrimaryKeyFromLogicalSchema(tableName: string, logicalSchema: unknown): string[] {
  if (!logicalSchema || typeof logicalSchema !== 'object') return [];
  const ls = logicalSchema as {
    kind?: string;
    tables?: Array<{ name: string; columns?: Array<{ name?: string; primaryKey?: boolean }> }>;
  };
  if (ls.kind !== 'sql' || !Array.isArray(ls.tables)) return [];
  const t = ls.tables.find((x) => x.name === tableName);
  if (!t?.columns?.length) return [];
  return t.columns.filter((c) => c.primaryKey && c.name).map((c) => String(c.name));
}

function pgDataTypeFallback(dataType: string | undefined | null): string {
  const d = String(dataType ?? '').toLowerCase();
  const map: Record<string, string> = {
    'character varying': 'TEXT',
    varchar: 'TEXT',
    text: 'TEXT',
    integer: 'INTEGER',
    bigint: 'BIGINT',
    smallint: 'SMALLINT',
    boolean: 'BOOLEAN',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'timestamp without time zone': 'TIMESTAMP',
    date: 'DATE',
    jsonb: 'JSONB',
    json: 'JSON',
    uuid: 'UUID',
    numeric: 'NUMERIC',
    'double precision': 'DOUBLE PRECISION',
    real: 'REAL',
    bytea: 'BYTEA',
  };
  return map[d] || 'TEXT';
}

export function buildPostgresCreateTableFromBackupColumns(
  tableName: string,
  columns: any[],
  primaryKeyColumns: string[] | undefined,
  logicalSchema: unknown,
): string {
  if (!columns?.length) {
    throw new Error(`Бэкап таблицы «${tableName}» без описания колонок — нельзя создать таблицу заново`);
  }
  const colNames = new Set(columns.map((c) => String(c.column_name)));
  const defs = columns.map((col) => {
    const name = quoteIdent(String(col.column_name));
    const typ = String(col.pg_type ?? '').trim() || pgDataTypeFallback(col.data_type);
    const nullClause = String(col.is_nullable).toUpperCase() === 'YES' ? 'NULL' : 'NOT NULL';
    return `${name} ${typ} ${nullClause}`;
  });
  let pk = Array.isArray(primaryKeyColumns) && primaryKeyColumns.length ? [...primaryKeyColumns] : [];
  if (!pk.length) pk = inferPrimaryKeyFromLogicalSchema(tableName, logicalSchema);
  pk = pk.filter((n) => colNames.has(n));
  const parts = [...defs];
  if (pk.length) {
    parts.push(`PRIMARY KEY (${pk.map((n) => quoteIdent(n)).join(', ')})`);
  }
  return `CREATE TABLE ${quoteIdent('public')}.${quoteIdent(tableName)} (${parts.join(', ')})`;
}

/** Таблицы, которые не удаляем при «полном» восстановлении, если их нет в снимке (служебные). */
const NEVER_DROP_PUBLIC_TABLES = new Set(['_prisma_migrations']);

async function pgTableExists(client: import('pg').PoolClient, tableName: string): Promise<boolean> {
  const r = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS e`,
    [tableName],
  );
  return Boolean(r.rows[0]?.e);
}

async function getPgFkParentChildEdges(
  client: import('pg').PoolClient,
  backupNames: Set<string>,
): Promise<Array<[string, string]>> {
  const r = await client.query(`
    SELECT
      parent_cls.relname::text AS parent_table,
      child_cls.relname::text AS child_table
    FROM pg_constraint c
    JOIN pg_class child_cls ON child_cls.oid = c.conrelid
    JOIN pg_class parent_cls ON parent_cls.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = child_cls.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `);
  const edges: Array<[string, string]> = [];
  for (const row of r.rows) {
    const p = String(row.parent_table);
    const ch = String(row.child_table);
    if (backupNames.has(p) && backupNames.has(ch)) edges.push([p, ch]);
  }
  return edges;
}

/** Сортировка: родительские таблицы перед дочерними (для INSERT). Рёбра: [parent, child]. */
function topoSortParentsFirst(tableNames: string[], parentChild: Array<[string, string]>): string[] {
  const set = new Set(tableNames);
  const edges = parentChild.filter(([p, c]) => set.has(p) && set.has(c));
  const childrenOf = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const t of tableNames) indegree.set(t, 0);
  for (const [p, c] of edges) {
    if (!childrenOf.has(p)) childrenOf.set(p, new Set());
    childrenOf.get(p)!.add(c);
    indegree.set(c, (indegree.get(c) ?? 0) + 1);
  }
  const queue = tableNames.filter((t) => (indegree.get(t) ?? 0) === 0).sort();
  const result: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    result.push(n);
    for (const child of childrenOf.get(n) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1);
      if (indegree.get(child) === 0) {
        queue.push(child);
        queue.sort();
      }
    }
  }
  if (result.length < tableNames.length) {
    const rest = tableNames.filter((t) => !result.includes(t)).sort();
    result.push(...rest);
  }
  return result;
}

export async function restoreBackupPayload(connection: PostgresConnectionInput, payload: any) {
  const pool = createPostgresPool(connection);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let replicationRoleReplica = false;
    try {
      await client.query(`SET LOCAL session_replication_role = replica`);
      replicationRoleReplica = true;
    } catch {
      /* Ошибка помечает транзакцию aborted — открываем новую без replication_role */
      await client.query('ROLLBACK');
      await client.query('BEGIN');
    }

    const backupTables = (payload.tables ?? []) as any[];
    const backupNames = new Set(backupTables.map((t) => String(t.name)));

    const dbTablesRes = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    for (const row of dbTablesRes.rows) {
      const name = String(row.tablename);
      if (backupNames.has(name) || NEVER_DROP_PUBLIC_TABLES.has(name)) continue;
      await client.query(`DROP TABLE IF EXISTS ${quoteIdent('public')}.${quoteIdent(name)} CASCADE`);
    }

    const fkEdges = await getPgFkParentChildEdges(client, backupNames);
    const insertOrder = topoSortParentsFirst([...backupNames], fkEdges);
    const deleteOrder = [...insertOrder].reverse();

    for (const name of deleteOrder) {
      if (await pgTableExists(client, name)) {
        await client.query(`DELETE FROM ${quoteIdent('public')}.${quoteIdent(name)}`);
      }
    }

    for (const table of backupTables) {
      if (!(await pgTableExists(client, String(table.name)))) {
        const ddl = buildPostgresCreateTableFromBackupColumns(
          String(table.name),
          table.columns ?? [],
          table.primaryKeyColumns,
          payload.logicalSchema,
        );
        await client.query(ddl);
      }
    }

    for (const name of insertOrder) {
      const table = backupTables.find((t) => String(t.name) === name);
      if (!table) continue;
      for (const row of table.rows as any[]) {
        const keys = Object.keys(row);
        if (keys.length === 0) continue;
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const cols = keys.map((key) => quoteIdent(key)).join(', ');
        const values = keys.map((key) => row[key]);
        await client.query(
          `INSERT INTO ${quoteIdent('public')}.${quoteIdent(name)} (${cols}) VALUES (${placeholders})`,
          values,
        );
      }
    }

    if (replicationRoleReplica) {
      await client.query(`SET LOCAL session_replication_role = DEFAULT`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
