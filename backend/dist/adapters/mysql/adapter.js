import mysql from 'mysql2/promise';
function quoteIdent(value) {
    return `\`${value.replace(/`/g, '``')}\``;
}
function quoteLiteral(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/**
 * При host=localhost mysql2 на Unix часто ходит через Unix socket; сервер тогда проверяет user@localhost,
 * а мы создаём привилегии для user@'%'. Принудительно используем TCP на loopback.
 */
export function normalizeMysqlTcpHost(host) {
    const h = host.trim().toLowerCase();
    if (h === 'localhost' || h === '::1')
        return '127.0.0.1';
    return host.trim();
}
function createConnection(input) {
    return mysql.createConnection({
        host: normalizeMysqlTcpHost(input.host),
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        ssl: input.ssl ? {} : undefined,
        multipleStatements: false,
    });
}
function buildConnectionString(input) {
    const host = normalizeMysqlTcpHost(input.host);
    return `mysql://${input.user}:${input.password}@${host}:${input.port}/${input.database}`;
}
function normalizeType(type) {
    return type.trim().replace(/\s+/g, ' ').toUpperCase();
}
function mapMySqlType(column) {
    const dataType = String(column.DATA_TYPE ?? column.data_type ?? '').toLowerCase();
    const columnType = String(column.COLUMN_TYPE ?? column.column_type ?? '').toLowerCase();
    if (column.extra?.toLowerCase().includes('auto_increment')) {
        if (dataType === 'bigint')
            return 'BIGINT AUTO_INCREMENT';
        return 'INTEGER AUTO_INCREMENT';
    }
    if (dataType === 'varchar')
        return `VARCHAR(${column.CHARACTER_MAXIMUM_LENGTH ?? column.character_maximum_length ?? 255})`;
    if (dataType === 'decimal')
        return `DECIMAL(${column.NUMERIC_PRECISION ?? column.numeric_precision ?? 10},${column.NUMERIC_SCALE ?? column.numeric_scale ?? 0})`;
    if (columnType)
        return columnType.toUpperCase();
    return dataType.toUpperCase() || 'TEXT';
}
async function testConnection(input) {
    const conn = await createConnection(input);
    try {
        const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS database_name');
        return {
            version: String(rows[0]?.version ?? ''),
            database: String(rows[0]?.database_name ?? input.database),
        };
    }
    finally {
        await conn.end();
    }
}
async function provisionManagedDatabase(input) {
    const conn = await createConnection(input.admin);
    try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdent(input.databaseName)}`);
        const u = quoteLiteral(input.ownerUser);
        const p = quoteLiteral(input.ownerPassword);
        const db = quoteIdent(input.databaseName);
        for (const host of ["'%'", "'localhost'"]) {
            await conn.query(`CREATE USER IF NOT EXISTS ${u}@${host} IDENTIFIED BY ${p}`);
            await conn.query(`ALTER USER ${u}@${host} IDENTIFIED BY ${p}`);
            await conn.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${u}@${host}`);
        }
        await conn.query('FLUSH PRIVILEGES');
    }
    finally {
        await conn.end();
    }
}
export async function dropMysqlManagedDatabase(admin, databaseName, ownerUser) {
    const conn = await mysql.createConnection({
        host: normalizeMysqlTcpHost(admin.host),
        port: admin.port,
        user: admin.user,
        password: admin.password,
        database: 'mysql',
        ssl: admin.ssl ? {} : undefined,
        multipleStatements: false,
    });
    try {
        await conn.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
        const u = quoteLiteral(ownerUser);
        await conn.query(`DROP USER IF EXISTS ${u}@'localhost'`);
        await conn.query(`DROP USER IF EXISTS ${u}@'%'`);
        await conn.query('FLUSH PRIVILEGES');
    }
    finally {
        await conn.end();
    }
}
async function listSchema(input) {
    const conn = await createConnection(input);
    try {
        const [rows] = await conn.query(`
      SELECT
        t.TABLE_NAME AS name,
        COUNT(c.COLUMN_NAME) AS columns,
        COALESCE(t.TABLE_ROWS, 0) AS rows_count,
        CONCAT(ROUND(((COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) / 1024 / 1024), 2), ' MB') AS size
      FROM information_schema.TABLES t
      LEFT JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
      GROUP BY t.TABLE_NAME, t.TABLE_ROWS, t.DATA_LENGTH, t.INDEX_LENGTH
      ORDER BY t.TABLE_NAME
    `);
        return rows.map((row) => ({
            name: String(row.name),
            columns: Number(row.columns ?? 0),
            rows: Number(row.rows_count ?? 0),
            size: String(row.size ?? '0 MB'),
        }));
    }
    finally {
        await conn.end();
    }
}
async function getTableData(input, table, limit, offset) {
    const conn = await createConnection(input);
    try {
        const [colRows] = await conn.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [table]);
        const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(table)} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
        return {
            columns: colRows.map((row) => String(row.COLUMN_NAME)),
            rows: rows,
        };
    }
    finally {
        await conn.end();
    }
}
async function runQuery(input, query, values = []) {
    const conn = await createConnection(input);
    try {
        const [rows, fields] = await conn.query(query, values);
        return {
            columns: Array.isArray(fields) ? fields.map((field) => String(field.name)) : [],
            rows: Array.isArray(rows) ? rows : [],
            rowCount: Array.isArray(rows) ? rows.length : Number(rows?.affectedRows ?? 0),
        };
    }
    finally {
        await conn.end();
    }
}
async function insertRow(input, table, data) {
    const conn = await createConnection(input);
    try {
        const keys = Object.keys(data);
        const placeholders = keys.map(() => '?').join(', ');
        const columns = keys.map((key) => quoteIdent(key)).join(', ');
        await conn.query(`INSERT INTO ${quoteIdent(table)} (${columns}) VALUES (${placeholders})`, keys.map((key) => data[key]));
        const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY 1 DESC LIMIT 1`);
        return rows[0] ?? {};
    }
    finally {
        await conn.end();
    }
}
async function updateRow(input, table, pkColumn, pkValue, patch) {
    const conn = await createConnection(input);
    try {
        const keys = Object.keys(patch);
        if (keys.length === 0)
            return null;
        const setClause = keys.map((key) => `${quoteIdent(key)} = ?`).join(', ');
        await conn.query(`UPDATE ${quoteIdent(table)} SET ${setClause} WHERE ${quoteIdent(pkColumn)} = ?`, [...keys.map((key) => patch[key]), pkValue]);
        const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkColumn)} = ? LIMIT 1`, [pkValue]);
        return rows[0] ?? null;
    }
    finally {
        await conn.end();
    }
}
async function deleteRow(input, table, pkColumn, pkValue) {
    const conn = await createConnection(input);
    try {
        const [result] = await conn.query(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkColumn)} = ?`, [pkValue]);
        return Number(result?.affectedRows ?? 0);
    }
    finally {
        await conn.end();
    }
}
function inferPrimaryKeyFromLogicalSchemaMysql(tableName, logicalSchema) {
    if (!logicalSchema || typeof logicalSchema !== 'object')
        return [];
    const ls = logicalSchema;
    if (ls.kind !== 'sql' || !Array.isArray(ls.tables))
        return [];
    const t = ls.tables.find((x) => x.name === tableName);
    if (!t?.columns?.length)
        return [];
    return t.columns.filter((c) => c.primaryKey && c.name).map((c) => String(c.name));
}
function buildMysqlCreateTableFromBackup(tableName, columns, primaryKeyColumns, logicalSchema) {
    if (!columns?.length) {
        throw new Error(`Бэкап таблицы «${tableName}» без описания колонок — нельзя создать таблицу заново`);
    }
    const colNames = new Set(columns.map((c) => String(c.COLUMN_NAME)));
    let pk = Array.isArray(primaryKeyColumns) && primaryKeyColumns.length ? [...primaryKeyColumns] : [];
    if (!pk.length)
        pk = inferPrimaryKeyFromLogicalSchemaMysql(tableName, logicalSchema);
    pk = pk.filter((n) => colNames.has(n));
    const parts = [];
    for (const col of columns) {
        const name = quoteIdent(String(col.COLUMN_NAME));
        const typ = String(col.COLUMN_TYPE);
        const nullClause = String(col.IS_NULLABLE).toUpperCase() === 'YES' ? 'NULL' : 'NOT NULL';
        let def = '';
        if (col.COLUMN_DEFAULT != null && String(col.COLUMN_DEFAULT) !== '') {
            const d = String(col.COLUMN_DEFAULT);
            if (d.toUpperCase() !== 'NULL')
                def = ` DEFAULT ${col.COLUMN_DEFAULT}`;
        }
        const extra = col.EXTRA ? ` ${String(col.EXTRA)}` : '';
        parts.push(`${name} ${typ} ${nullClause}${def}${extra}`);
    }
    if (pk.length) {
        parts.push(`PRIMARY KEY (${pk.map((c) => quoteIdent(c)).join(', ')})`);
    }
    return `CREATE TABLE ${quoteIdent(tableName)} (\n  ${parts.join(',\n  ')}\n)`;
}
const NEVER_DROP_MYSQL_TABLES = new Set(['_prisma_migrations']);
async function exportBackupPayload(input) {
    const conn = await createConnection(input);
    try {
        const schema = await listSchema(input);
        const tables = [];
        for (const table of schema) {
            const [columns] = await conn.query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`, [table.name]);
            const primaryKeyColumns = columns.filter((c) => String(c.COLUMN_KEY).toUpperCase() === 'PRI').map((c) => String(c.COLUMN_NAME));
            const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(table.name)}`);
            tables.push({ name: table.name, columns, primaryKeyColumns, rows });
        }
        return { tables };
    }
    finally {
        await conn.end();
    }
}
async function restoreBackupPayload(input, payload) {
    const conn = await createConnection(input);
    try {
        await conn.beginTransaction();
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        const backupTables = payload.tables ?? [];
        const backupNames = new Set(backupTables.map((t) => String(t.name)));
        const [dbRows] = await conn.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
        for (const row of dbRows) {
            const name = String(row.TABLE_NAME);
            if (backupNames.has(name) || NEVER_DROP_MYSQL_TABLES.has(name))
                continue;
            await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
        }
        for (const table of backupTables) {
            const tname = String(table.name);
            const [exists] = await conn.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [tname]);
            if (!Array.isArray(exists) || exists.length === 0) {
                const ddl = buildMysqlCreateTableFromBackup(tname, table.columns ?? [], table.primaryKeyColumns, payload.logicalSchema);
                await conn.query(ddl);
            }
            else {
                await conn.query(`TRUNCATE TABLE ${quoteIdent(tname)}`);
            }
        }
        for (const table of backupTables) {
            for (const row of table.rows ?? []) {
                const keys = Object.keys(row);
                if (!keys.length)
                    continue;
                const placeholders = keys.map(() => '?').join(', ');
                await conn.query(`INSERT INTO ${quoteIdent(String(table.name))} (${keys.map(quoteIdent).join(', ')}) VALUES (${placeholders})`, keys.map((key) => row[key]));
            }
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.commit();
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        await conn.end();
    }
}
async function exportConstructorSchema(input) {
    const conn = await createConnection(input);
    try {
        const [tableRows] = await conn.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`);
        const tables = [];
        const relations = [];
        for (const [index, row] of tableRows.entries()) {
            const tableName = String(row.TABLE_NAME);
            const [columns] = await conn.query(`
        SELECT c.COLUMN_NAME, c.DATA_TYPE, c.COLUMN_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE,
               c.COLUMN_DEFAULT, c.EXTRA,
               EXISTS (
                 SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
                 WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY'
               ) AS is_primary_key,
               EXISTS (
                 SELECT 1 FROM information_schema.STATISTICS s
                 WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = c.TABLE_NAME AND s.COLUMN_NAME = c.COLUMN_NAME AND s.NON_UNIQUE = 0 AND s.INDEX_NAME <> 'PRIMARY'
               ) AS is_unique
        FROM information_schema.COLUMNS c
        WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION
      `, [tableName]);
            const [fks] = await conn.query(`
        SELECT COLUMN_NAME AS from_column, REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_column, CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [tableName]);
            tables.push({
                id: tableName,
                name: tableName,
                x: 60 + (index % 3) * 420,
                y: 60 + Math.floor(index / 3) * 260,
                columns: columns.map((column) => ({
                    id: String(column.COLUMN_NAME),
                    name: String(column.COLUMN_NAME),
                    type: mapMySqlType(column),
                    primaryKey: Boolean(column.is_primary_key),
                    nullable: String(column.IS_NULLABLE) === 'YES',
                    unique: Boolean(column.is_unique),
                    defaultValue: column.COLUMN_DEFAULT == null ? null : String(column.COLUMN_DEFAULT),
                })),
            });
            for (const fk of fks) {
                relations.push({
                    id: String(fk.CONSTRAINT_NAME),
                    fromTable: tableName,
                    fromColumn: String(fk.from_column),
                    toTable: String(fk.to_table),
                    toColumn: String(fk.to_column),
                });
            }
        }
        return { tables, relations };
    }
    finally {
        await conn.end();
    }
}
async function fetchMysqlColumnType(conn, tableName, columnName) {
    const [rows] = await conn.query(`SELECT COLUMN_TYPE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [tableName, columnName]);
    if (!rows?.length)
        return null;
    return { columnType: String(rows[0].COLUMN_TYPE), extra: String(rows[0].EXTRA ?? '') };
}
function normalizeMysqlColumnTypeDisplay(value) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Несколько выражений через `;` (DDL/DML). Отдельное соединение от интерактивных запросов. */
export async function runMysqlMigrationSql(input, sql) {
    const conn = await mysql.createConnection({
        host: normalizeMysqlTcpHost(input.host),
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        ssl: input.ssl ? {} : undefined,
        multipleStatements: true,
    });
    try {
        await conn.query(sql);
    }
    finally {
        await conn.end();
    }
}
export async function truncateMysqlTable(input, table) {
    await runMysqlMigrationSql(input, `TRUNCATE TABLE ${quoteIdent(table)}`);
}
async function applyConstructorSchema(input, schema) {
    const conn = await createConnection(input);
    try {
        await conn.beginTransaction();
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        const [existingRows] = await conn.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
        const existing = new Set(existingRows.map((row) => String(row.TABLE_NAME)));
        const desired = new Set(schema.tables.map((table) => table.name));
        for (const tableName of existing) {
            if (!desired.has(tableName)) {
                await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
            }
        }
        for (const table of schema.tables) {
            if (!existing.has(table.name)) {
                const cols = table.columns.map((column) => {
                    const parts = [quoteIdent(column.name), normalizeType(column.type)];
                    if (column.primaryKey)
                        parts.push('PRIMARY KEY');
                    if (column.unique)
                        parts.push('UNIQUE');
                    if ((column.nullable === false || column.primaryKey) && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        parts.push('NOT NULL');
                    if (column.defaultValue && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        parts.push(`DEFAULT ${column.defaultValue}`);
                    return parts.join(' ');
                }).join(', ');
                await conn.query(`CREATE TABLE ${quoteIdent(table.name)} (${cols || '`id` INTEGER PRIMARY KEY AUTO_INCREMENT'}) ENGINE=InnoDB`);
                continue;
            }
            const [columnRows] = await conn.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table.name]);
            const existingColumns = new Set(columnRows.map((row) => String(row.COLUMN_NAME)));
            const desiredColumns = new Set(table.columns.map((column) => column.name));
            for (const columnName of existingColumns) {
                if (!desiredColumns.has(columnName)) {
                    await conn.query(`ALTER TABLE ${quoteIdent(table.name)} DROP COLUMN ${quoteIdent(columnName)}`);
                }
            }
            for (const column of table.columns) {
                const baseDef = `${quoteIdent(column.name)} ${normalizeType(column.type)}`;
                if (!existingColumns.has(column.name)) {
                    const clauses = [baseDef];
                    if ((column.nullable === false || column.primaryKey) && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        clauses.push('NOT NULL');
                    if (column.defaultValue && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        clauses.push(`DEFAULT ${column.defaultValue}`);
                    await conn.query(`ALTER TABLE ${quoteIdent(table.name)} ADD COLUMN ${clauses.join(' ')}`);
                }
                else {
                    const clauses = [baseDef];
                    if ((column.nullable === false || column.primaryKey) && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        clauses.push('NOT NULL');
                    if (column.defaultValue && !normalizeType(column.type).includes('AUTO_INCREMENT'))
                        clauses.push(`DEFAULT ${column.defaultValue}`);
                    await conn.query(`ALTER TABLE ${quoteIdent(table.name)} MODIFY COLUMN ${clauses.join(' ')}`);
                }
            }
        }
        const desiredTableNameList = [...desired];
        if (desiredTableNameList.length > 0) {
            const placeholders = desiredTableNameList.map(() => '?').join(', ');
            const [fkRows] = await conn.query(`
        SELECT TABLE_NAME, CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
          AND TABLE_NAME IN (${placeholders})
      `, desiredTableNameList);
            for (const row of fkRows) {
                const t = String(row.TABLE_NAME);
                const c = String(row.CONSTRAINT_NAME);
                await conn.query(`ALTER TABLE ${quoteIdent(t)} DROP FOREIGN KEY ${quoteIdent(c)}`);
            }
        }
        for (const relation of schema.relations ?? []) {
            if (!desired.has(relation.fromTable) || !desired.has(relation.toTable))
                continue;
            const [fromCol] = await conn.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [relation.fromTable, relation.fromColumn]);
            const [toCol] = await conn.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [relation.toTable, relation.toColumn]);
            if (!fromCol?.length || !toCol?.length)
                continue;
            const refMeta = await fetchMysqlColumnType(conn, relation.toTable, relation.toColumn);
            const fkMeta = await fetchMysqlColumnType(conn, relation.fromTable, relation.fromColumn);
            if (refMeta && fkMeta) {
                const refT = normalizeMysqlColumnTypeDisplay(refMeta.columnType);
                const fkT = normalizeMysqlColumnTypeDisplay(fkMeta.columnType);
                if (refT !== fkT) {
                    const fromTableSchema = schema.tables.find((t) => t.name === relation.fromTable);
                    const fromColSchema = fromTableSchema?.columns.find((c) => c.name === relation.fromColumn);
                    if (!fromColSchema) {
                        throw new Error(`Несовместимые типы FK: ${relation.fromTable}.${relation.fromColumn} (${fkMeta.columnType}) → ${relation.toTable}.${relation.toColumn} (${refMeta.columnType}). Укажите столбец в схеме конструктора.`);
                    }
                    if (fkMeta.extra.toLowerCase().includes('auto_increment')) {
                        throw new Error(`Столбец ${relation.fromTable}.${relation.fromColumn} с AUTO_INCREMENT нельзя автоматически привести к типу «${refMeta.columnType}» для внешнего ключа. Задайте совместимый тип вручную.`);
                    }
                    const nullClause = fromColSchema.nullable === false ? 'NOT NULL' : 'NULL';
                    await conn.query(`ALTER TABLE ${quoteIdent(relation.fromTable)} MODIFY COLUMN ${quoteIdent(relation.fromColumn)} ${refMeta.columnType} ${nullClause}`);
                }
            }
            const rawName = `${relation.fromTable}_${relation.fromColumn}_fk`;
            const constraintName = rawName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
            await conn.query(`
        ALTER TABLE ${quoteIdent(relation.fromTable)}
        ADD CONSTRAINT ${quoteIdent(constraintName)}
        FOREIGN KEY (${quoteIdent(relation.fromColumn)})
        REFERENCES ${quoteIdent(relation.toTable)} (${quoteIdent(relation.toColumn)})
        ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.commit();
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        await conn.end();
    }
}
export { testConnection as testMysqlConnection, provisionManagedDatabase as provisionMysqlDatabase, listSchema as listMysqlSchema, getTableData as getMysqlTableData, runQuery as runMysqlSql, insertRow as insertMysqlRow, updateRow as updateMysqlRow, deleteRow as deleteMysqlRow, exportBackupPayload as exportMysqlBackupPayload, restoreBackupPayload as restoreMysqlBackupPayload, exportConstructorSchema as exportMysqlConstructorSchema, applyConstructorSchema as applyMysqlConstructorSchema, };
export const mysqlAdapter = {
    engine: 'mysql',
    title: 'MySQL',
    defaultPort: 3306,
    queryLanguage: 'sql',
    entityLabel: 'table',
    capabilities: {
        schema: true,
        data: true,
        query: true,
        constructor: true,
        backups: true,
        migrations: true,
        managedProvision: true,
        externalRegister: true,
    },
    buildConnectionString,
    testConnection,
    getLiveConnections: async (input) => {
        try {
            const res = await runQuery(input, 'SELECT COUNT(*) AS connections FROM information_schema.processlist WHERE db = DATABASE()');
            return Number(res.rows[0]?.connections ?? 0);
        }
        catch {
            return 0;
        }
    },
    provisionManagedDatabase,
    listSchema,
    getTableData,
    runQuery,
    insertRow,
    updateRow,
    deleteRow,
    exportBackupPayload,
    restoreBackupPayload,
    exportConstructorSchema,
    applyConstructorSchema,
};
