import { buildPostgresCreateTableFromBackupColumns } from '../../adapters/postgres/adapter.js';
function pgQI(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function myQI(value) {
    return `\`${value.replace(/`/g, '``')}\``;
}
function fkEdgesFromLogicalSchema(logicalSchema, backupNames) {
    if (!logicalSchema || typeof logicalSchema !== 'object')
        return [];
    const ls = logicalSchema;
    if (ls.kind !== 'sql' || !Array.isArray(ls.relations))
        return [];
    const edges = [];
    for (const r of ls.relations) {
        const parent = String(r.toTable);
        const child = String(r.fromTable);
        if (backupNames.has(parent) && backupNames.has(child))
            edges.push([parent, child]);
    }
    return edges;
}
function topoSortParentsFirst(tableNames, parentChild) {
    const set = new Set(tableNames);
    const edges = parentChild.filter(([p, c]) => set.has(p) && set.has(c));
    const childrenOf = new Map();
    const indegree = new Map();
    for (const t of tableNames)
        indegree.set(t, 0);
    for (const [p, c] of edges) {
        if (!childrenOf.has(p))
            childrenOf.set(p, new Set());
        childrenOf.get(p).add(c);
        indegree.set(c, (indegree.get(c) ?? 0) + 1);
    }
    const queue = tableNames.filter((t) => (indegree.get(t) ?? 0) === 0).sort();
    const result = [];
    while (queue.length) {
        const n = queue.shift();
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
        result.push(...tableNames.filter((t) => !result.includes(t)).sort());
    }
    return result;
}
function pgEscapeLiteral(val) {
    if (val === null || val === undefined)
        return 'NULL';
    if (typeof val === 'boolean')
        return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number')
        return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'object') {
        if (Array.isArray(val))
            return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
        const bufObj = val;
        if (bufObj?.type === 'Buffer' && Array.isArray(bufObj.data)) {
            const buf = Buffer.from(bufObj.data);
            return `E'\\\\x${buf.toString('hex')}'`;
        }
        try {
            return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
        }
        catch {
            return 'NULL';
        }
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}
function buildPostgresInsert(tableName, row) {
    const keys = Object.keys(row);
    if (!keys.length)
        return '';
    const cols = keys.map((k) => pgQI(k)).join(', ');
    const vals = keys.map((k) => pgEscapeLiteral(row[k])).join(', ');
    return `INSERT INTO ${pgQI('public')}.${pgQI(tableName)} (${cols}) VALUES (${vals});`;
}
function mysqlEscapeLiteral(val) {
    if (val === null || val === undefined)
        return 'NULL';
    if (typeof val === 'boolean')
        return val ? '1' : '0';
    if (typeof val === 'number')
        return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'object') {
        if (val instanceof Date)
            return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
        const bufObj = val;
        if (bufObj?.type === 'Buffer' && Array.isArray(bufObj.data)) {
            const buf = Buffer.from(bufObj.data);
            return `X'${buf.toString('hex')}'`;
        }
        return `'${JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    }
    return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
function buildMysqlCreateTableFromBackupPayload(table, logicalSchema) {
    const columns = table.columns ?? [];
    if (!columns.length)
        throw new Error(`Таблица «${table.name}» без колонок в бэкапе`);
    const colNames = new Set(columns.map((c) => String(c.COLUMN_NAME)));
    let pk = Array.isArray(table.primaryKeyColumns) ? [...table.primaryKeyColumns] : [];
    if (!pk.length && logicalSchema && typeof logicalSchema === 'object') {
        const ls = logicalSchema;
        if (ls.kind === 'sql' && ls.tables) {
            const t = ls.tables.find((x) => x.name === table.name);
            pk = (t?.columns ?? []).filter((c) => c.primaryKey && c.name).map((c) => String(c.name));
        }
    }
    pk = pk.filter((n) => colNames.has(n));
    const parts = [];
    for (const col of columns) {
        const name = myQI(String(col.COLUMN_NAME));
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
    if (pk.length)
        parts.push(`PRIMARY KEY (${pk.map((c) => myQI(c)).join(', ')})`);
    return `CREATE TABLE ${myQI(String(table.name))} (\n  ${parts.join(',\n  ')}\n)`;
}
function buildMysqlInsert(tableName, row) {
    const keys = Object.keys(row);
    if (!keys.length)
        return '';
    const cols = keys.map((k) => myQI(k)).join(', ');
    const vals = keys.map((k) => mysqlEscapeLiteral(row[k])).join(', ');
    return `INSERT INTO ${myQI(tableName)} (${cols}) VALUES (${vals});`;
}
export function buildPostgresSqlDump(payload, includeData) {
    const lines = [
        '-- МояБД: PostgreSQL dump из JSON-бэкапа',
        '-- Порядок таблиц учитывает FK; session_replication_role не используется — совместимо с обычными ролями.',
        'BEGIN;',
    ];
    const backupTables = payload.tables ?? [];
    const backupNames = new Set(backupTables.map((t) => String(t.name)));
    const edges = fkEdgesFromLogicalSchema(payload.logicalSchema, backupNames);
    const insertOrder = topoSortParentsFirst([...backupNames], edges);
    const dropOrder = [...insertOrder].reverse();
    for (const name of dropOrder) {
        lines.push(`DROP TABLE IF EXISTS ${pgQI('public')}.${pgQI(name)} CASCADE;`);
    }
    for (const name of insertOrder) {
        const t = backupTables.find((x) => String(x.name) === name);
        if (!t?.columns?.length)
            continue;
        lines.push(`${buildPostgresCreateTableFromBackupColumns(name, t.columns, t.primaryKeyColumns, payload.logicalSchema)};`);
    }
    if (includeData) {
        for (const name of insertOrder) {
            const t = backupTables.find((x) => String(x.name) === name);
            if (!t?.rows?.length)
                continue;
            for (const row of t.rows) {
                const stmt = buildPostgresInsert(name, row);
                if (stmt)
                    lines.push(stmt);
            }
        }
    }
    lines.push('COMMIT;');
    return lines.join('\n');
}
export function buildMysqlSqlDump(payload, includeData) {
    const lines = ['-- МояБД: MySQL dump из JSON-бэкапа', 'SET FOREIGN_KEY_CHECKS = 0;', 'START TRANSACTION;'];
    const backupTables = payload.tables ?? [];
    const backupNames = new Set(backupTables.map((t) => String(t.name)));
    const edges = fkEdgesFromLogicalSchema(payload.logicalSchema, backupNames);
    const insertOrder = topoSortParentsFirst([...backupNames], edges);
    const dropOrder = [...insertOrder].reverse();
    for (const name of dropOrder) {
        lines.push(`DROP TABLE IF EXISTS ${myQI(name)};`);
    }
    for (const name of insertOrder) {
        const t = backupTables.find((x) => String(x.name) === name);
        if (!t?.columns?.length)
            continue;
        lines.push(`${buildMysqlCreateTableFromBackupPayload(t, payload.logicalSchema)};`);
    }
    if (includeData) {
        for (const name of insertOrder) {
            const t = backupTables.find((x) => String(x.name) === name);
            if (!t?.rows?.length)
                continue;
            for (const row of t.rows) {
                const stmt = buildMysqlInsert(name, row);
                if (stmt)
                    lines.push(stmt);
            }
        }
    }
    lines.push('COMMIT;');
    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    return lines.join('\n');
}
