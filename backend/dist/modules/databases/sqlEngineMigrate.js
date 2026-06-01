/**
 * Конвертация JSON-снимка SQL-бэкапа между PostgreSQL и MySQL для restore на целевой СУБД.
 */
function inferPayloadSourceEngine(payload) {
    const platform = String(payload.platformEngine ?? '').toLowerCase();
    if (platform.includes('mysql') || platform.includes('mariadb'))
        return 'mysql';
    if (platform.includes('postgres'))
        return 'postgresql';
    const tables = payload.tables;
    const firstCol = tables?.[0]?.columns?.[0];
    if (firstCol && typeof firstCol.COLUMN_NAME === 'string')
        return 'mysql';
    return 'postgresql';
}
/** varchar(255) CHARACTER SET utf8mb4 COLLATE … → varchar(255) */
function normalizeMysqlColumnType(raw) {
    return raw
        .replace(/\s+CHARACTER\s+SET\s+\w+/gi, '')
        .replace(/\s+COLLATE\s+[\w_]+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function mapPgTypeToMysql(pgTypeRaw, dataType) {
    const pg = String(pgTypeRaw || '').trim().toLowerCase();
    const dt = String(dataType ?? '').toLowerCase();
    if (!pg && dt) {
        const fallback = {
            'character varying': 'VARCHAR(255)',
            varchar: 'VARCHAR(255)',
            text: 'LONGTEXT',
            integer: 'INT',
            bigint: 'BIGINT',
            smallint: 'SMALLINT',
            boolean: 'TINYINT(1)',
            json: 'JSON',
            jsonb: 'JSON',
            uuid: 'CHAR(36)',
            numeric: 'DECIMAL(18,6)',
            date: 'DATE',
            bytea: 'LONGBLOB',
        };
        return fallback[dt] ?? 'LONGTEXT';
    }
    if (pg.includes('[]'))
        return 'JSON';
    const uuidLike = pg === 'uuid';
    if (uuidLike)
        return 'CHAR(36)';
    if (pg.startsWith('character varying')) {
        const m = pg.match(/character varying\s*\(\s*(\d+)\s*\)/);
        return m ? `VARCHAR(${m[1]})` : 'VARCHAR(255)';
    }
    if (pg.startsWith('varchar')) {
        const m = pg.match(/varchar\s*\(\s*(\d+)\s*\)/);
        return m ? `VARCHAR(${m[1]})` : 'VARCHAR(255)';
    }
    if (pg === 'text' || pg.startsWith('text('))
        return 'LONGTEXT';
    if (pg.startsWith('char(')) {
        const m = pg.match(/char\s*\(\s*(\d+)\s*\)/);
        return m ? `CHAR(${m[1]})` : 'CHAR(36)';
    }
    if (pg.includes('timestamp with time zone') || pg === 'timestamptz')
        return 'DATETIME(6)';
    if (pg.includes('timestamp') || pg === 'timestamp without time zone')
        return 'DATETIME';
    if (pg === 'date')
        return 'DATE';
    if (pg === 'time' || pg.startsWith('time '))
        return 'TIME';
    if (pg === 'boolean' || pg === 'bool')
        return 'TINYINT(1)';
    if (pg === 'smallint' || pg === 'int2')
        return 'SMALLINT';
    if (pg === 'integer' || pg === 'int' || pg === 'int4')
        return 'INT';
    if (pg === 'bigint' || pg === 'int8')
        return 'BIGINT';
    if (pg === 'serial')
        return 'INT';
    if (pg === 'bigserial')
        return 'BIGINT';
    if (pg === 'json' || pg === 'jsonb')
        return 'JSON';
    if (pg.startsWith('numeric') || pg.startsWith('decimal')) {
        const m = pg.match(/numeric\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/) || pg.match(/decimal\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        return m ? `DECIMAL(${m[1]},${m[2]})` : 'DECIMAL(18,6)';
    }
    if (pg === 'double precision' || pg === 'float8')
        return 'DOUBLE';
    if (pg === 'real' || pg === 'float4')
        return 'FLOAT';
    if (pg === 'bytea')
        return 'LONGBLOB';
    if (pg.startsWith('bit'))
        return 'BIT(1)';
    return 'LONGTEXT';
}
function mapMysqlTypeToPg(mysqlTypeRaw, extra) {
    const raw = normalizeMysqlColumnType(mysqlTypeRaw);
    const low = raw.toLowerCase();
    const extraLow = String(extra ?? '').toLowerCase();
    if (low.startsWith('tinyint(1)') || low === 'bit(1)')
        return 'BOOLEAN';
    if (low.startsWith('tinyint'))
        return 'SMALLINT';
    if (low.startsWith('smallint'))
        return 'SMALLINT';
    if (low.startsWith('mediumint'))
        return 'INTEGER';
    if (low.startsWith('bigint'))
        return 'BIGINT';
    if (low.startsWith('int'))
        return 'INTEGER';
    if (low.startsWith('double') || low.startsWith('float'))
        return 'DOUBLE PRECISION';
    if (low.startsWith('decimal') || low.startsWith('numeric')) {
        const m = raw.match(/^(decimal|numeric)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        return m ? `NUMERIC(${m[2]},${m[3]})` : 'NUMERIC(18,6)';
    }
    if (low.startsWith('varchar')) {
        const m = raw.match(/varchar\s*\(\s*(\d+)\s*\)/i);
        return m ? `character varying(${m[1]})` : 'TEXT';
    }
    if (low.startsWith('char(')) {
        const m = raw.match(/char\s*\(\s*(\d+)\s*\)/i);
        return m ? `CHAR(${m[1]})` : 'CHAR(36)';
    }
    if (low.startsWith('text') || low.startsWith('longtext') || low.startsWith('mediumtext') || low.startsWith('tinytext')) {
        return 'TEXT';
    }
    if (low.startsWith('json'))
        return 'JSONB';
    if (low.startsWith('datetime') || low.startsWith('timestamp')) {
        return low.includes('(6)') || extraLow.includes('on update') ? 'TIMESTAMP WITH TIME ZONE' : 'TIMESTAMP WITHOUT TIME ZONE';
    }
    if (low.startsWith('date'))
        return 'DATE';
    if (low.startsWith('time'))
        return 'TIME WITHOUT TIME ZONE';
    if (low.startsWith('blob') || low.startsWith('longblob') || low.startsWith('mediumblob') || low.startsWith('tinyblob') || low.startsWith('binary') || low.startsWith('varbinary')) {
        return 'BYTEA';
    }
    if (low.startsWith('enum') || low.startsWith('set'))
        return 'TEXT';
    return 'TEXT';
}
function pgDataTypeFromPgType(pgType) {
    const p = pgType.trim().toLowerCase();
    if (p.startsWith('character varying'))
        return 'character varying';
    if (p.startsWith('varchar'))
        return 'character varying';
    if (p.startsWith('timestamp with time zone') || p === 'timestamptz')
        return 'timestamp with time zone';
    if (p.startsWith('timestamp'))
        return 'timestamp without time zone';
    if (p.startsWith('time'))
        return 'time without time zone';
    const base = p.split(/\s+/)[0] ?? p;
    return base.replace(/[(),]/g, '') || 'text';
}
function normalizeCellForMysql(mysqlColumnType, value) {
    if (value === null || value === undefined)
        return value === undefined ? null : value;
    const t = mysqlColumnType.toUpperCase();
    if (t.includes('JSON')) {
        if (typeof value === 'object')
            return JSON.stringify(value);
        return value;
    }
    if (t.includes('TINYINT(1)') || t === 'BOOLEAN') {
        if (typeof value === 'boolean')
            return value ? 1 : 0;
    }
    if (Buffer.isBuffer(value))
        return value;
    if (Array.isArray(value))
        return JSON.stringify(value);
    return value;
}
function normalizeCellForPostgres(pgType, value) {
    if (value === null || value === undefined)
        return value === undefined ? null : value;
    const p = pgType.toLowerCase();
    if (p === 'boolean' || p === 'bool') {
        if (value === 0 || value === '0')
            return false;
        if (value === 1 || value === '1')
            return true;
    }
    if (p.includes('json') || p.includes('jsonb')) {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            }
            catch {
                return value;
            }
        }
    }
    return value;
}
function convertRowsForMysql(columns, primaryKeyColumns, rows) {
    const pk = new Set(primaryKeyColumns ?? []);
    const types = new Map();
    for (const c of columns) {
        const name = String(c.COLUMN_NAME);
        types.set(name, String(c.COLUMN_TYPE));
        if (pk.has(name)) {
            c.COLUMN_KEY = 'PRI';
        }
    }
    return (rows ?? []).map((row) => {
        const out = {};
        for (const key of Object.keys(row)) {
            const mysqlTyp = types.get(key) ?? 'LONGTEXT';
            out[key] = normalizeCellForMysql(mysqlTyp, row[key]);
        }
        return out;
    });
}
function convertRowsForPostgres(columns, rows) {
    const types = new Map();
    for (const c of columns) {
        types.set(String(c.column_name), String(c.pg_type));
    }
    return (rows ?? []).map((row) => {
        const out = {};
        for (const key of Object.keys(row)) {
            const pgTyp = types.get(key) ?? 'TEXT';
            out[key] = normalizeCellForPostgres(pgTyp, row[key]);
        }
        return out;
    });
}
function convertTablePostgresToMysql(table) {
    const primaryKeyColumns = Array.isArray(table.primaryKeyColumns) ? [...table.primaryKeyColumns] : [];
    const cols = (table.columns ?? []).map((col) => {
        const name = String(col.column_name);
        const mysqlType = mapPgTypeToMysql(String(col.pg_type ?? ''), col.data_type);
        return {
            COLUMN_NAME: name,
            COLUMN_TYPE: mysqlType,
            IS_NULLABLE: String(col.is_nullable).toUpperCase() === 'YES' ? 'YES' : 'NO',
            COLUMN_DEFAULT: null,
            EXTRA: '',
            COLUMN_KEY: primaryKeyColumns.includes(name) ? 'PRI' : '',
        };
    });
    const rows = convertRowsForMysql(cols, primaryKeyColumns, table.rows ?? []);
    return {
        name: table.name,
        columns: cols,
        primaryKeyColumns,
        rows,
    };
}
function convertTableMysqlToPostgres(table) {
    const primaryKeyColumns = Array.isArray(table.primaryKeyColumns) ? [...table.primaryKeyColumns] : [];
    const cols = (table.columns ?? []).map((col) => {
        const name = String(col.COLUMN_NAME);
        const mysqlTyp = normalizeMysqlColumnType(String(col.COLUMN_TYPE));
        const pgType = mapMysqlTypeToPg(mysqlTyp, String(col.EXTRA ?? ''));
        return {
            column_name: name,
            pg_type: pgType,
            is_nullable: String(col.IS_NULLABLE).toUpperCase() === 'YES' ? 'YES' : 'NO',
            data_type: pgDataTypeFromPgType(pgType),
        };
    });
    const rows = convertRowsForPostgres(cols, table.rows ?? []);
    return {
        name: table.name,
        columns: cols,
        primaryKeyColumns,
        rows,
    };
}
/**
 * Приводит payload (формат buildFullBackupPayload для SQL) к виду, который понимает restore целевой СУБД.
 */
export function convertSqlBackupPayloadForEngine(payload, target) {
    const source = inferPayloadSourceEngine(payload);
    if (source === target) {
        return { ...payload };
    }
    const tables = payload.tables ?? [];
    const convertedTables = target === 'mysql' ? tables.map(convertTablePostgresToMysql) : tables.map(convertTableMysqlToPostgres);
    return {
        ...payload,
        platformEngine: target === 'mysql' ? 'MySQL' : 'PostgreSQL',
        tables: convertedTables,
        logicalSchema: payload.logicalSchema,
    };
}
