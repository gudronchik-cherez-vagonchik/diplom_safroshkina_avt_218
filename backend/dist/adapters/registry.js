import { mysqlAdapter } from './mysql/adapter.js';
export const adapterRegistry = {
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
