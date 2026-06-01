export type SqlDialect = 'postgres' | 'mysql';

export type WizardMigrationOpKind =
  | 'add_column'
  | 'drop_column'
  | 'create_index'
  | 'rename_table'
  | 'rename_column';

export type WizardMigrationOp =
  | { kind: 'add_column'; table: string; column: string; sqlType: string; nullable: boolean; defaultExpr?: string }
  | { kind: 'drop_column'; table: string; column: string }
  | { kind: 'create_index'; table: string; indexName: string; columnsCsv: string; unique: boolean }
  | { kind: 'rename_table'; from: string; to: string }
  | { kind: 'rename_column'; table: string; from: string; to: string };

export function detectSqlDialect(engine: string): SqlDialect {
  const e = engine.toLowerCase();
  if (e.includes('mysql') || e.includes('mariadb')) return 'mysql';
  return 'postgres';
}

function quoteIdent(dialect: SqlDialect, id: string): string {
  const trimmed = id.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Недопустимое имя «${id}»: используйте латиницу, цифры и символ _.`);
  }
  return dialect === 'mysql' ? `\`${trimmed.replace(/`/g, '``')}\`` : `"${trimmed.replace(/"/g, '""')}"`;
}

function assertSafeFragment(value: string, label: string) {
  const v = value.trim();
  if (!v) return;
  if (/[;]/.test(v)) throw new Error(`${label}: уберите точку с запятой`);
  if (/--|\/\*|\*\//.test(v)) throw new Error(`${label}: комментарии в этом поле не допускаются`);
}

export function buildWizardMigrationSql(dialect: SqlDialect, op: WizardMigrationOp): string {
  const q = (id: string) => quoteIdent(dialect, id);

  switch (op.kind) {
    case 'add_column': {
      assertSafeFragment(op.sqlType, 'Тип колонки');
      const st = op.sqlType.trim();
      if (!st) throw new Error('Укажите тип колонки');
      const nullClause = op.nullable ? 'NULL' : 'NOT NULL';
      const defRaw = op.defaultExpr?.trim();
      if (defRaw) assertSafeFragment(defRaw, 'Значение по умолчанию');
      const defClause = defRaw ? ` DEFAULT ${defRaw}` : '';
      return `ALTER TABLE ${q(op.table)} ADD COLUMN ${q(op.column)} ${st} ${nullClause}${defClause}`;
    }
    case 'drop_column':
      return `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)}`;
    case 'create_index': {
      assertSafeFragment(op.indexName, 'Имя индекса');
      const parts = op.columnsCsv
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!parts.length) throw new Error('Укажите хотя бы одну колонку через запятую');
      parts.forEach((c) => quoteIdent(dialect, c));
      const uniq = op.unique ? 'UNIQUE ' : '';
      const list = parts.map((c) => q(c)).join(', ');
      return `CREATE ${uniq}INDEX ${q(op.indexName)} ON ${q(op.table)} (${list})`;
    }
    case 'rename_table':
      return dialect === 'mysql'
        ? `RENAME TABLE ${q(op.from)} TO ${q(op.to)}`
        : `ALTER TABLE ${q(op.from)} RENAME TO ${q(op.to)}`;
    case 'rename_column':
      return `ALTER TABLE ${q(op.table)} RENAME COLUMN ${q(op.from)} TO ${q(op.to)}`;
  }
}

export const WIZARD_SQL_TYPES_POSTGRES = [
  'VARCHAR(255)',
  'TEXT',
  'INTEGER',
  'BIGINT',
  'BOOLEAN',
  'TIMESTAMPTZ',
  'JSONB',
  'UUID',
  'DOUBLE PRECISION',
] as const;

export const WIZARD_SQL_TYPES_MYSQL = [
  'VARCHAR(255)',
  'TEXT',
  'INT',
  'BIGINT',
  'BOOLEAN',
  'DATETIME',
  'JSON',
  'DOUBLE',
] as const;
