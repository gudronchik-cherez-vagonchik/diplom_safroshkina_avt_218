import { createPostgresPool } from './adapter.js';
const SYSTEM_TABLES = new Set(['_prisma_migrations']);
function quoteIdent(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function isNextvalDefault(value) {
    return typeof value === 'string' && /nextval\(/i.test(value);
}
function mapDataType(column) {
    const udt = String(column.udt_name ?? '').toLowerCase();
    const dataType = String(column.data_type ?? '').toLowerCase();
    const defaultValue = column.column_default ? String(column.column_default) : '';
    const maxLength = column.character_maximum_length ? Number(column.character_maximum_length) : null;
    const precision = column.numeric_precision ? Number(column.numeric_precision) : null;
    const scale = column.numeric_scale ? Number(column.numeric_scale) : null;
    if (isNextvalDefault(defaultValue)) {
        if (udt === 'int2')
            return 'SMALLSERIAL';
        if (udt === 'int4')
            return 'SERIAL';
        if (udt === 'int8')
            return 'BIGSERIAL';
    }
    if (dataType === 'character varying')
        return maxLength ? `VARCHAR(${maxLength})` : 'VARCHAR(255)';
    if (dataType === 'character')
        return maxLength ? `CHAR(${maxLength})` : 'CHAR(1)';
    if (dataType === 'text')
        return 'TEXT';
    if (dataType === 'boolean')
        return 'BOOLEAN';
    if (dataType === 'date')
        return 'DATE';
    if (dataType === 'timestamp without time zone')
        return 'TIMESTAMP';
    if (dataType === 'timestamp with time zone')
        return 'TIMESTAMPTZ';
    if (udt === 'int2')
        return 'SMALLINT';
    if (udt === 'int4')
        return 'INTEGER';
    if (udt === 'int8')
        return 'BIGINT';
    if (udt === 'float4')
        return 'REAL';
    if (udt === 'float8')
        return 'DOUBLE PRECISION';
    if (udt === 'numeric')
        return precision ? `NUMERIC(${precision}${scale !== null && scale >= 0 ? `, ${scale}` : ''})` : 'NUMERIC';
    if (udt === 'uuid')
        return 'UUID';
    if (udt === 'json')
        return 'JSON';
    if (udt === 'jsonb')
        return 'JSONB';
    if (udt === 'bytea')
        return 'BYTEA';
    return String(column.data_type ?? column.udt_name ?? 'TEXT').toUpperCase();
}
function autoPosition(index) {
    const col = index % 3;
    const row = Math.floor(index / 3);
    return { x: 60 + col * 420, y: 60 + row * 260 };
}
export async function exportConstructorSchema(connection) {
    const pool = createPostgresPool(connection);
    try {
        const tablesRes = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name ASC
    `);
        const tables = [];
        const relations = [];
        for (const [index, row] of tablesRes.rows.entries()) {
            const tableName = row.table_name;
            const pos = autoPosition(index);
            const columnsRes = await pool.query(`
        SELECT
          c.column_name,
          c.udt_name,
          c.data_type,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.is_nullable,
          c.column_default,
          EXISTS (
            SELECT 1
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = c.table_name
              AND tc.constraint_type = 'PRIMARY KEY'
              AND kcu.column_name = c.column_name
          ) AS is_primary_key,
          EXISTS (
            SELECT 1
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = c.table_name
              AND tc.constraint_type = 'UNIQUE'
              AND kcu.column_name = c.column_name
          ) AS is_unique
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position
      `, [tableName]);
            const fkRes = await pool.query(`
        SELECT
          kcu.column_name AS from_column,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
      `, [tableName]);
            tables.push({
                id: tableName,
                name: tableName,
                x: pos.x,
                y: pos.y,
                columns: columnsRes.rows.map((column) => ({
                    id: column.column_name,
                    name: column.column_name,
                    type: mapDataType(column),
                    primaryKey: Boolean(column.is_primary_key),
                    nullable: column.is_nullable === 'YES',
                    unique: Boolean(column.is_unique),
                    defaultValue: column.column_default ? String(column.column_default) : null,
                })),
            });
            for (const fk of fkRes.rows) {
                if (SYSTEM_TABLES.has(String(fk.to_table)))
                    continue;
                relations.push({
                    id: String(fk.constraint_name),
                    fromTable: tableName,
                    fromColumn: String(fk.from_column),
                    toTable: String(fk.to_table),
                    toColumn: String(fk.to_column),
                });
            }
        }
        return { tables, relations, viewport: undefined };
    }
    finally {
        await pool.end();
    }
}
async function getExistingTables(client) {
    const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `);
    return new Set(res.rows.map((row) => String(row.table_name)));
}
async function getExistingColumns(client, tableName) {
    const res = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
    return new Set(res.rows.map((row) => String(row.column_name)));
}
async function getExistingForeignKeys(client, tableNames) {
    if (tableNames.length === 0)
        return [];
    const res = await client.query(`
    SELECT
      tc.table_name,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = ANY($1::text[])
  `, [tableNames]);
    return res.rows;
}
function normalizeType(type) {
    return type.trim().replace(/\s+/g, ' ').toUpperCase();
}
function isSerialType(type) {
    const value = normalizeType(type);
    return value === 'SERIAL' || value === 'BIGSERIAL' || value === 'SMALLSERIAL';
}
function serialBaseType(type) {
    const value = normalizeType(type);
    if (value === 'SMALLSERIAL')
        return 'SMALLINT';
    if (value === 'BIGSERIAL')
        return 'BIGINT';
    return 'INTEGER';
}
export async function applyConstructorSchema(connection, schema) {
    const pool = createPostgresPool(connection);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const desiredTables = schema.tables.filter((table) => !SYSTEM_TABLES.has(table.name));
        const desiredTableNames = new Set(desiredTables.map((table) => table.name));
        const existingTableNames = await getExistingTables(client);
        for (const tableName of existingTableNames) {
            if (!desiredTableNames.has(tableName)) {
                await client.query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)} CASCADE`);
            }
        }
        for (const table of desiredTables) {
            const tableName = table.name;
            const exists = existingTableNames.has(tableName);
            if (!exists) {
                const columnsSql = table.columns.map((column) => {
                    const normalizedType = normalizeType(column.type);
                    const parts = [quoteIdent(column.name), normalizedType];
                    if (column.primaryKey)
                        parts.push('PRIMARY KEY');
                    if ((column.nullable === false || column.primaryKey) && !isSerialType(normalizedType))
                        parts.push('NOT NULL');
                    if (column.unique)
                        parts.push('UNIQUE');
                    if (column.defaultValue && !isSerialType(normalizedType))
                        parts.push(`DEFAULT ${column.defaultValue}`);
                    return parts.join(' ');
                }).join(', ');
                await client.query(`CREATE TABLE ${quoteIdent(tableName)} (${columnsSql || `${quoteIdent('id')} SERIAL PRIMARY KEY`})`);
                continue;
            }
            const existingColumns = await getExistingColumns(client, tableName);
            const desiredColumns = new Set(table.columns.map((column) => column.name));
            for (const existingColumn of existingColumns) {
                if (!desiredColumns.has(existingColumn)) {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} DROP COLUMN IF EXISTS ${quoteIdent(existingColumn)} CASCADE`);
                }
            }
            for (const column of table.columns) {
                const columnType = normalizeType(column.type);
                const serialType = isSerialType(columnType);
                if (!existingColumns.has(column.name)) {
                    const parts = [quoteIdent(column.name), columnType];
                    if ((column.nullable === false || column.primaryKey) && !serialType)
                        parts.push('NOT NULL');
                    if (column.defaultValue && !serialType)
                        parts.push(`DEFAULT ${column.defaultValue}`);
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${parts.join(' ')}`);
                }
                else if (!serialType) {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} TYPE ${columnType}`);
                }
                else {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} TYPE ${serialBaseType(columnType)}`);
                }
                if (!serialType) {
                    if (column.defaultValue) {
                        await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} SET DEFAULT ${column.defaultValue}`);
                    }
                    else {
                        await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} DROP DEFAULT`);
                    }
                }
                if (column.nullable === false || column.primaryKey) {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} SET NOT NULL`);
                }
                else {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column.name)} DROP NOT NULL`);
                }
                const uniqueName = `${tableName}_${column.name}_key`;
                if (column.unique) {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} ADD CONSTRAINT ${quoteIdent(uniqueName)} UNIQUE (${quoteIdent(column.name)})`).catch((error) => {
                        if (error?.code !== '42710')
                            throw error;
                    });
                }
                else {
                    await client.query(`ALTER TABLE ${quoteIdent(tableName)} DROP CONSTRAINT IF EXISTS ${quoteIdent(uniqueName)}`);
                }
            }
        }
        const fkRows = await getExistingForeignKeys(client, desiredTables.map((table) => table.name));
        for (const fk of fkRows) {
            await client.query(`ALTER TABLE ${quoteIdent(fk.table_name)} DROP CONSTRAINT IF EXISTS ${quoteIdent(fk.constraint_name)}`);
        }
        for (const relation of schema.relations ?? []) {
            if (!desiredTableNames.has(relation.fromTable) || !desiredTableNames.has(relation.toTable))
                continue;
            const fromExists = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      `, [relation.fromTable, relation.fromColumn]);
            const toExists = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      `, [relation.toTable, relation.toColumn]);
            if (fromExists.rowCount === 0 || toExists.rowCount === 0)
                continue;
            const constraintName = `${relation.fromTable}_${relation.fromColumn}_fkey`;
            await client.query(`
        ALTER TABLE ${quoteIdent(relation.fromTable)}
        ADD CONSTRAINT ${quoteIdent(constraintName)}
        FOREIGN KEY (${quoteIdent(relation.fromColumn)})
        REFERENCES ${quoteIdent(relation.toTable)} (${quoteIdent(relation.toColumn)})
        ON DELETE NO ACTION
      `);
        }
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
        await pool.end();
    }
}
