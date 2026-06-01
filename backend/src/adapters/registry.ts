import type { DatabaseAdapterModule } from './contracts/database-adapter.js';
import { mysqlAdapter } from './mysql/adapter.js';

export const adapterRegistry: Record<string, DatabaseAdapterModule> = {
  postgres: {
    engine: 'postgres',
    title: 'PostgreSQL',
    defaultPort: 5432,
  },
  mysql: mysqlAdapter,
};

export function listAvailableAdapters() {
  return Object.values(adapterRegistry);
}
