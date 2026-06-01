import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { applyConstructor, createManagedMongoDatabase, createManagedMysqlDatabase, createManagedPostgresDatabase, createMongoCollectionForUser, createRow, deleteDatabase, deleteMongoCollectionForUser, executeSql, getConstructor, getDatabase, getDatabaseConnectionInfo, getMongoVisualState, getSchema, getTableRows, listDatabases, patchRow, registerExistingMongo, registerExistingMysql, registerExistingPostgres, removeRow, truncateTable, saveConstructorLayout, migrateManagedSqlEngine, syncManagedDatabaseHealth, moveDatabaseToProject, } from './service.js';
const connectionSchema = z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
    ssl: z.boolean().optional(),
});
const registerSchema = z.object({
    projectId: z.string().min(1),
    name: z.string().min(2),
    connection: connectionSchema,
    tags: z.array(z.string()).optional(),
});
const managedProvisionSchema = z.object({
    projectId: z.string().min(1),
    name: z.string().min(2),
    tags: z.array(z.string()).optional(),
    initialSql: z.string().max(600_000).optional(),
});
const querySchema = z.object({
    sql: z.string().min(1),
    values: z.array(z.any()).optional(),
});
const insertSchema = z.object({
    data: z.record(z.any()),
});
const patchSchema = z.object({
    pkColumn: z.string().min(1),
    pkValue: z.any(),
    patch: z.record(z.any()),
});
const deleteSchema = z.object({
    pkColumn: z.string().min(1),
    pkValue: z.any(),
});
const constructorSchema = z.object({
    tables: z.array(z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional(),
        columns: z.array(z.object({
            id: z.string().optional(),
            name: z.string().min(1),
            type: z.string().min(1),
            primaryKey: z.boolean().optional(),
            nullable: z.boolean().optional(),
            unique: z.boolean().optional(),
            defaultValue: z.string().nullable().optional(),
        })),
    })),
    relations: z.array(z.object({
        id: z.string().optional(),
        fromTable: z.string().min(1),
        fromColumn: z.string().min(1),
        toTable: z.string().min(1),
        toColumn: z.string().min(1),
    })).optional(),
    viewport: z.object({
        zoom: z.number(),
        panX: z.number(),
        panY: z.number(),
    }).optional(),
    tableColors: z.record(z.string()).optional(),
});
const constructorLayoutSchema = z.object({
    layout: z.record(z.object({ x: z.number(), y: z.number() })),
    viewport: z.object({ zoom: z.number(), panX: z.number(), panY: z.number() }).optional(),
    tableColors: z.record(z.string()).optional(),
});
const collectionSchema = z.object({ name: z.string().min(1) });
const migrateSqlEngineSchema = z.object({
    targetEngine: z.enum(['postgresql', 'mysql']),
});
export async function databasesRoutes(app) {
    app.get('/', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        return listDatabases(user.sub);
    });
    app.get('/:id', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return getDatabase(user.sub, params.id);
    });
    app.patch('/:id/project', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = z.object({ projectId: z.string().min(1) }).parse(request.body);
        return moveDatabaseToProject(user.sub, params.id, body.projectId);
    });
    app.post('/postgres/register', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = registerSchema.parse(request.body);
        return registerExistingPostgres(user.sub, body);
    });
    app.post('/postgres/provision-managed', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = managedProvisionSchema.parse(request.body);
        return createManagedPostgresDatabase(user.sub, body);
    });
    app.post('/mongodb/register', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = registerSchema.parse(request.body);
        return registerExistingMongo(user.sub, body);
    });
    app.post('/mongodb/provision-managed', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = managedProvisionSchema.parse(request.body);
        return createManagedMongoDatabase(user.sub, body);
    });
    app.post('/mysql/register', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = registerSchema.parse(request.body);
        return registerExistingMysql(user.sub, body);
    });
    app.post('/mysql/provision-managed', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = managedProvisionSchema.parse(request.body);
        return createManagedMysqlDatabase(user.sub, body);
    });
    app.get('/:id/connection', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const forwardedHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0].trim();
        const hostWithoutPort = forwardedHost.replace(/:\d+$/, '');
        return getDatabaseConnectionInfo(user.sub, params.id, { host: hostWithoutPort || undefined });
    });
    app.get('/:id/schema', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return getSchema(user.sub, params.id);
    });
    app.get('/:id/constructor', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return getConstructor(user.sub, params.id);
    });
    app.post('/:id/constructor/apply', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = constructorSchema.parse(request.body);
        return applyConstructor(user.sub, params.id, body);
    });
    app.post('/:id/constructor/layout', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = constructorLayoutSchema.parse(request.body);
        return saveConstructorLayout(user.sub, params.id, body);
    });
    app.get('/:id/mongo/visual', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return getMongoVisualState(user.sub, params.id);
    });
    app.post('/:id/mongo/collections', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = collectionSchema.parse(request.body);
        return createMongoCollectionForUser(user.sub, params.id, body.name);
    });
    app.delete('/:id/mongo/collections/:collection', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), collection: z.string() }).parse(request.params);
        return deleteMongoCollectionForUser(user.sub, params.id, params.collection);
    });
    app.post('/:id/migrate-sql-engine', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = migrateSqlEngineSchema.parse(request.body);
        return migrateManagedSqlEngine(user.sub, params.id, body.targetEngine);
    });
    app.post('/:id/sync-health', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return syncManagedDatabaseHealth(user.sub, params.id);
    });
    app.get('/:id/data/:table', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), table: z.string() }).parse(request.params);
        const query = z.object({ limit: z.coerce.number().int().positive().default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
        return getTableRows(user.sub, params.id, params.table, query.limit, query.offset);
    });
    app.post('/:id/tables/:table/truncate', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), table: z.string().min(1) }).parse(request.params);
        return truncateTable(user.sub, params.id, params.table);
    });
    app.post('/:id/query', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        const body = querySchema.parse(request.body);
        return executeSql(user.sub, params.id, body.sql, body.values ?? []);
    });
    app.post('/:id/tables/:table/rows', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), table: z.string() }).parse(request.params);
        const body = insertSchema.parse(request.body);
        return createRow(user.sub, params.id, params.table, body.data);
    });
    app.patch('/:id/tables/:table/rows', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), table: z.string() }).parse(request.params);
        const body = patchSchema.parse(request.body);
        return patchRow(user.sub, params.id, params.table, body.pkColumn, body.pkValue, body.patch);
    });
    app.delete('/:id/tables/:table/rows', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string(), table: z.string() }).parse(request.params);
        const body = deleteSchema.parse(request.body);
        return { deleted: await removeRow(user.sub, params.id, params.table, body.pkColumn, body.pkValue) };
    });
    app.delete('/:id', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        return deleteDatabase(user.sub, params.id);
    });
}
