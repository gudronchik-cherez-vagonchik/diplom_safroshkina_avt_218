import type { DatabaseAdapterModule } from '../contracts/database-adapter.js';
import {
  deleteRow,
  exportBackupPayload,
  getTableData,
  insertRow,
  listSchema,
  provisionDatabase,
  runSql,
  testConnection,
  updateRow,
  type PostgresConnectionInput,
} from './adapter.js';
import { applyConstructorSchema, exportConstructorSchema } from './constructor.js';

function getConnectionString(input: PostgresConnectionInput) {
  return `postgresql://${input.user}:${input.password}@${input.host}:${input.port}/${input.database}`;
}

export const postgresAdapter: DatabaseAdapterModule = {
  engine: 'postgres',
  title: 'PostgreSQL',
  defaultPort: 5432,
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
  buildConnectionString: getConnectionString,
  testConnection,
  getLiveConnections: async (input) => {
    const result = await runSql(input, `
      SELECT COALESCE(numbackends, 0)::int AS connections
      FROM pg_stat_database
      WHERE datname = current_database()
    `);
    const value = result.rows[0]?.connections;
    return typeof value === 'number' ? value : Number(value ?? 0);
  },
  provisionManagedDatabase: async ({ admin, databaseName, ownerUser, ownerPassword }) => {
    await provisionDatabase({ admin, databaseName, ownerUser, ownerPassword });
  },
  listSchema,
  getTableData,
  runQuery: runSql,
  insertRow,
  updateRow,
  deleteRow,
  exportBackupPayload,
  restoreBackupPayload: async (input, payload) => {
    const { restoreBackupPayload } = await import('./adapter.js');
    return restoreBackupPayload(input, payload);
  },
  exportConstructorSchema,
  applyConstructorSchema,
};
