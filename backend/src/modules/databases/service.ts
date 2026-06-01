import crypto from 'node:crypto';
import { DatabaseStatus, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { decryptSecret, encryptSecret, maskConnectionString } from '../../lib/crypto.js';
import { assertFound, HttpError } from '../../lib/http.js';
import { memberHasMinRole } from '../../lib/roles.js';
import {
  platformMongoConfig,
  platformMongoPublicConfig,
  platformMysqlConfig,
  platformMysqlPublicConfig,
  platformPgConfig,
  platformPgPublicConfig,
} from '../../config/env.js';
import {
  deleteRow,
  dropPostgresManagedDatabase,
  getTableData,
  insertRow,
  listSchema,
  PostgresConnectionInput,
  provisionDatabase,
  restoreBackupPayload as restorePostgresBackupPayload,
  runSql,
  testConnection,
  truncatePublicTable,
  updateRow,
} from '../../adapters/postgres/adapter.js';
import { applyConstructorSchema, exportConstructorSchema, type ConstructorSchema } from '../../adapters/postgres/constructor.js';
import {
  createMongoCollection,
  deleteMongoCollection,
  deleteMongoDocument,
  clearMongoCollection,
  exportMongoBackupPayload,
  getMongoCollectionData,
  getMongoVisual,
  insertMongoDocument,
  listMongoCollections,
  MongoConnectionInput,
  provisionMongoDatabase,
  restoreMongoBackupPayload,
  testMongoConnection,
  dropMongoManagedDatabase,
  updateMongoDocument,
} from '../../adapters/mongodb/adapter.js';
import {
  applyMysqlConstructorSchema,
  deleteMysqlRow,
  exportMysqlBackupPayload,
  exportMysqlConstructorSchema,
  getMysqlTableData,
  insertMysqlRow,
  listMysqlSchema,
  MysqlConnectionInput,
  provisionMysqlDatabase,
  restoreMysqlBackupPayload,
  runMysqlMigrationSql,
  runMysqlSql,
  testMysqlConnection,
  dropMysqlManagedDatabase,
  normalizeMysqlTcpHost,
  truncateMysqlTable,
  updateMysqlRow,
} from '../../adapters/mysql/adapter.js';
import { convertSqlBackupPayloadForEngine } from './sqlEngineMigrate.js';
import { explainDbRuntimeError, type DbEngineKind } from '../../lib/dbErrors.js';
import { notifyUser, NotificationType } from '../notifications/service.js';
import { requireDatabaseProjectRole, requireProjectRole } from '../../lib/projectDbAccess.js';

export type SupportedEngine = 'postgres' | 'mongodb' | 'mysql';

type GenericConnectionInput = PostgresConnectionInput | MongoConnectionInput | MysqlConnectionInput;

type ConstructorState = {
  layout?: Record<string, { x: number; y: number }>;
  viewport?: { zoom: number; panX: number; panY: number };
  /** Имя таблицы → HEX, только UI */
  tableColors?: Record<string, string>;
};

function normalizeStatus(status: DatabaseStatus) {
  return status.toLowerCase();
}

function normalizeEngine(value: string): SupportedEngine {
  const engine = value.toLowerCase();
  if (engine === 'mongodb' || engine === 'mongo') return 'mongodb';
  if (engine === 'mysql' || engine === 'mariadb') return 'mysql';
  return 'postgres';
}

function getDisplayEngine(engine: SupportedEngine) {
  if (engine === 'mongodb') return 'MongoDB';
  if (engine === 'mysql') return 'MySQL';
  return 'PostgreSQL';
}

async function withReadableDbError<T>(engine: SupportedEngine, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, explainDbRuntimeError(engine as DbEngineKind, error));
  }
}

/** Блокирует запросы к живой БД, пока карточка в проблемном статусе (создание, миграция, ошибка). */
export function assertDatabaseReadyForWork(database: { status: DatabaseStatus }) {
  switch (database.status) {
    case DatabaseStatus.PROVISIONING:
      throw new HttpError(409, 'База ещё создаётся — подождите немного и обновите страницу.');
    case DatabaseStatus.MIGRATING:
      throw new HttpError(
        409,
        'С базой выполняется перенос или смена СУБД. Дождитесь окончания или откройте вкладку «Обзор».',
      );
    case DatabaseStatus.ERROR:
      throw new HttpError(
        409,
        'У базы статус «ошибка». На вкладке «Обзор» нажмите «Проверить подключение» или удалите карточку.',
      );
    default:
      break;
  }
}

function getConnectionString(input: GenericConnectionInput, engine: SupportedEngine) {
  if (engine === 'mongodb') {
    return `mongodb://${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${input.database}?authSource=${encodeURIComponent(input.database)}`;
  }
  if (engine === 'mysql') {
    return `mysql://${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${input.database}`;
  }
  return `postgresql://${input.user}:${input.password}@${input.host}:${input.port}/${input.database}`;
}

function getPublicConnection(
  database: Awaited<ReturnType<typeof requireDatabaseForUser>>,
  overrides?: { host?: string; port?: number; ssl?: boolean },
) {
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') {
    const isManagedHost = database.host === platformMongoConfig.host || database.region === 'managed';
    return {
      engine,
      host: isManagedHost ? (overrides?.host || platformMongoPublicConfig.host) : database.host,
      port: isManagedHost ? (overrides?.port || platformMongoPublicConfig.port) : database.port,
      database: database.databaseName,
      user: database.username,
      password: decryptSecret(database.passwordEncrypted),
      ssl: isManagedHost ? (typeof overrides?.ssl === 'boolean' ? overrides.ssl : platformMongoPublicConfig.ssl) : database.ssl,
    } satisfies MongoConnectionInput & { engine: SupportedEngine };
  }

  if (engine === 'mysql') {
    const isManagedHost = database.host === platformMysqlConfig.host || database.region === 'managed';
    const rawHost = isManagedHost ? (overrides?.host || platformMysqlPublicConfig.host) : database.host;
    return {
      engine,
      host: normalizeMysqlTcpHost(rawHost),
      port: isManagedHost ? (overrides?.port || platformMysqlPublicConfig.port) : database.port,
      database: database.databaseName,
      user: database.username,
      password: decryptSecret(database.passwordEncrypted),
      ssl: isManagedHost ? (typeof overrides?.ssl === 'boolean' ? overrides.ssl : platformMysqlPublicConfig.ssl) : database.ssl,
    } satisfies MysqlConnectionInput & { engine: SupportedEngine };
  }

  const isManagedHost = database.host === platformPgConfig.host || database.region === 'managed';
  return {
    engine,
    host: isManagedHost ? (overrides?.host || platformPgPublicConfig.host) : database.host,
    port: isManagedHost ? (overrides?.port || platformPgPublicConfig.port) : database.port,
    database: database.databaseName,
    user: database.username,
    password: decryptSecret(database.passwordEncrypted),
    ssl: isManagedHost ? (typeof overrides?.ssl === 'boolean' ? overrides.ssl : platformPgPublicConfig.ssl) : database.ssl,
  } satisfies PostgresConnectionInput & { engine: SupportedEngine };
}

function slugifyDatabaseName(input: string, prefix: string) {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'database';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${normalized}_${suffix}`.slice(0, 63);
}

function randomDbUser(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`.slice(0, 30);
}

function randomDbPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

const INITIAL_SQL_MAX_BYTES = 512 * 1024;

function parseOptionalInitialSql(raw: string | undefined | null): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (Buffer.byteLength(trimmed, 'utf8') > INITIAL_SQL_MAX_BYTES) {
    throw new HttpError(400, `Начальный SQL не длиннее ${INITIAL_SQL_MAX_BYTES / 1024} КБ`);
  }
  return trimmed;
}

export async function requireDatabaseForUser(databaseId: string, userId: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
  return database;
}

function assertSafeTableName(table: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new HttpError(400, 'Недопустимое имя таблицы');
  }
}

/** Имя коллекции MongoDB для операций очистки (не только `[a-z0-9_]`). */
function assertSafeMongoCollectionName(tableParam: string): string {
  const name = decodeURIComponent(tableParam).trim();
  if (!name || name.includes('\0') || name.startsWith('system.')) {
    throw new HttpError(400, 'Недопустимое имя коллекции');
  }
  if (Buffer.byteLength(name, 'utf8') > 120) {
    throw new HttpError(400, 'Имя коллекции слишком длинное');
  }
  return name;
}

export function getDecryptedConnection(database: Awaited<ReturnType<typeof requireDatabaseForUser>>): GenericConnectionInput {
  const common = {
    host: database.host,
    port: database.port,
    database: database.databaseName,
    user: database.username,
    password: decryptSecret(database.passwordEncrypted),
    ssl: database.ssl,
  };
  if (normalizeEngine(database.engine) === 'mysql') {
    return { ...common, host: normalizeMysqlTcpHost(database.host) };
  }
  return common;
}

async function getLiveConnectionsCount(database: Awaited<ReturnType<typeof requireDatabaseForUser>>) {
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') return database.connections ?? 0;
  if (engine === 'mysql') {
    try {
      const result = await runMysqlSql(
        getDecryptedConnection(database) as MysqlConnectionInput,
        'SELECT COUNT(*) AS connections FROM information_schema.processlist WHERE db = DATABASE()',
        [],
      );
      const value = result?.rows?.[0]?.connections;
      return typeof value === 'number' ? value : Number(value ?? 0);
    } catch {
      return database.connections ?? 0;
    }
  }
  try {
    const result = await runSql(
      getDecryptedConnection(database) as PostgresConnectionInput,
      `
      SELECT COALESCE(numbackends, 0)::int AS connections
      FROM pg_stat_database
      WHERE datname = current_database()
      `,
      [],
    );
    const value = result?.rows?.[0]?.connections;
    return typeof value === 'number' ? value : Number(value ?? 0);
  } catch {
    return database.connections ?? 0;
  }
}

export async function toPublicDatabase(database: Awaited<ReturnType<typeof requireDatabaseForUser>>) {
  const publicConnection = getPublicConnection(database);
  const liveConnections = await getLiveConnectionsCount(database);
  return {
    id: database.id,
    name: database.name,
    engine: getDisplayEngine(normalizeEngine(database.engine)),
    version: database.version,
    region: database.region,
    status: normalizeStatus(database.status),
    storage: database.storage,
    connections: liveConnections,
    projectId: database.projectId,
    tags: JSON.parse(database.tagsJson),
    createdAt: database.createdAt.toISOString(),
    connectionString: maskConnectionString(getConnectionString(publicConnection, publicConnection.engine)),
  };
}

export async function getDatabaseConnectionInfo(
  userId: string,
  databaseId: string,
  overrides?: { host?: string; port?: number; ssl?: boolean },
) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может видеть учётные данные подключения');
  const connection = getPublicConnection(database, overrides);
  return {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: Boolean(connection.ssl),
    connectionString: getConnectionString(connection, connection.engine),
  };
}

async function getUserName(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? 'Unknown';
}

function readConstructorState(raw: string | null | undefined): ConstructorState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function mergeConstructorState(schema: ConstructorSchema, state: ConstructorState): ConstructorSchema {
  const layout = state.layout ?? {};
  const colors = state.tableColors ?? {};
  return {
    ...schema,
    tables: schema.tables.map((table) => ({
      ...table,
      x: layout[table.name]?.x ?? table.x,
      y: layout[table.name]?.y ?? table.y,
      color: colors[table.name] ?? table.color,
    })),
    viewport: state.viewport,
  };
}

function buildConstructorState(schema: ConstructorSchema): ConstructorState {
  let colors: Record<string, string> = {};
  if (schema.tableColors !== undefined) {
    for (const [name, value] of Object.entries(schema.tableColors)) {
      if (value && String(value).trim()) colors[name] = String(value);
    }
  } else {
    colors = Object.fromEntries(
      (schema.tables ?? []).filter((table) => table.color && String(table.color).trim()).map((table) => [table.name, String(table.color)]),
    );
  }

  return {
    layout: Object.fromEntries((schema.tables ?? []).map((table) => [table.name, { x: table.x ?? 0, y: table.y ?? 0 }])),
    viewport: schema.viewport,
    ...(Object.keys(colors).length ? { tableColors: colors } : {}),
  };
}

function pruneConstructorState(state: ConstructorState, tableNames: string[]) {
  const allowed = new Set(tableNames);
  const nextLayout: Record<string, { x: number; y: number }> = {};
  for (const [tableName, coords] of Object.entries(state.layout ?? {})) {
    if (allowed.has(tableName)) nextLayout[tableName] = coords;
  }
  const nextColors: Record<string, string> = {};
  for (const [tableName, color] of Object.entries(state.tableColors ?? {})) {
    if (allowed.has(tableName)) nextColors[tableName] = color;
  }
  return {
    layout: nextLayout,
    viewport: state.viewport,
    ...(Object.keys(nextColors).length ? { tableColors: nextColors } : {}),
  } satisfies ConstructorState;
}

function computeConstructorStateJsonAfterSqlRestore(schema: ConstructorSchema, previousConstructorStateJson: string | null | undefined): string {
  const preserved = readConstructorState(previousConstructorStateJson);
  const pruned = pruneConstructorState(preserved, schema.tables.map((table) => table.name));
  const merged = mergeConstructorState(schema, pruned);
  return JSON.stringify(buildConstructorState(merged));
}

export async function listDatabases(userId: string) {
  const databases = await prisma.managedDatabase.findMany({
    where: { project: { members: { some: { userId } } } },
    orderBy: { createdAt: 'desc' },
  });
  if (databases.length === 0) return [];
  const projectIds = [...new Set(databases.map((d) => d.projectId))];
  const memberships = await prisma.projectMember.findMany({
    where: { userId, projectId: { in: projectIds } },
  });
  const roleByProject = new Map(memberships.map((m) => [m.projectId, m.role]));
  return Promise.all(
    databases.map(async (database) => ({
      ...(await toPublicDatabase(database as any)),
      myProjectRole: (roleByProject.get(database.projectId) ?? UserRole.VIEWER).toLowerCase(),
    })),
  );
}

export async function getDatabase(userId: string, databaseId: string) {
  const { database, role } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
  return { ...(await toPublicDatabase(database)), myProjectRole: role.toLowerCase() };
}

/** Перенос карточки БД в другой проект (нужны права редактора и в исходном, и в целевом проекте). */
export async function moveDatabaseToProject(userId: string, databaseId: string, targetProjectId: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Недостаточно прав для переноса этой базы');
  const sourceProjectId = database.projectId;
  if (sourceProjectId === targetProjectId) {
    return getDatabase(userId, databaseId);
  }

  const targetMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: targetProjectId, userId } },
  });
  if (!targetMembership || !memberHasMinRole(targetMembership.role, UserRole.EDITOR)) {
    throw new HttpError(403, 'Нет прав добавлять базы в выбранный проект');
  }

  const sourceMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: sourceProjectId, userId } },
  });
  if (!sourceMembership || !memberHasMinRole(sourceMembership.role, UserRole.EDITOR)) {
    throw new HttpError(403, 'Нет прав переносить эту базу из текущего проекта');
  }

  await prisma.managedDatabase.update({
    where: { id: database.id },
    data: { projectId: targetProjectId },
  });

  const targetProject = await prisma.project.findUnique({ where: { id: targetProjectId } });

  await prisma.auditLog.create({
    data: {
      action: 'База перенесена в другой проект',
      resource: database.name,
      userId,
      userName: await getUserName(userId),
      details: `${sourceProjectId} → ${targetProjectId}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_MOVED, `База «${database.name}» перенесена`, `Теперь в проекте «${targetProject?.name ?? targetProjectId}».`, {
    databaseId: database.id,
    databaseName: database.name,
    targetProjectId,
    targetProjectName: targetProject?.name ?? '',
    sourceProjectId,
  });

  return getDatabase(userId, databaseId);
}

/** Проверка живости инстанса и сброс статуса ERROR/MIGRATING после сбоев (например незавершённая миграция). */
export async function syncManagedDatabaseHealth(userId: string, databaseId: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может сбрасывать статус подключения');
  if (database.region !== 'managed') {
    throw new HttpError(400, 'Доступно только для управляемых баз МояБД.');
  }

  const engine = normalizeEngine(database.engine);

  try {
    if (engine === 'mongodb') {
      await testMongoConnection(getDecryptedConnection(database) as MongoConnectionInput);
    } else if (engine === 'mysql') {
      await testMysqlConnection(getDecryptedConnection(database) as MysqlConnectionInput);
    } else {
      await testConnection(getDecryptedConnection(database) as PostgresConnectionInput);
    }
  } catch (error: unknown) {
    throw new HttpError(400, explainDbRuntimeError(engine as DbEngineKind, error));
  }

  const data: { status: DatabaseStatus; host?: string } = { status: DatabaseStatus.RUNNING };
  if (engine === 'mysql') {
    const h = database.host.trim().toLowerCase();
    if (h === 'localhost' || h === '::1') {
      data.host = '127.0.0.1';
    }
  }

  await prisma.managedDatabase.update({
    where: { id: database.id },
    data,
  });

  return getDatabase(userId, databaseId);
}

export async function registerExistingPostgres(userId: string, input: {
  projectId: string;
  name: string;
  connection: PostgresConnectionInput;
  tags?: string[];
}) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Подключать внешние базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  const connectionInfo = await testConnection(input.connection);
  const connectionString = getConnectionString(input.connection, 'postgres');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'PostgreSQL',
      version: connectionInfo.version,
      region: 'external',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: input.connection.host,
      port: input.connection.port,
      databaseName: input.connection.database,
      username: input.connection.user,
      passwordEncrypted: encryptSecret(input.connection.password),
      ssl: Boolean(input.connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Подключён PostgreSQL',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Connected to ${input.connection.host}:${input.connection.port}/${input.connection.database}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CONNECTED, `Подключена БД «${input.name}»`, `PostgreSQL · проект «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'PostgreSQL',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function registerExistingMongo(userId: string, input: {
  projectId: string;
  name: string;
  connection: MongoConnectionInput;
  tags?: string[];
}) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Подключать внешние базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  const connectionInfo = await testMongoConnection(input.connection);
  const connectionString = getConnectionString(input.connection, 'mongodb');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'MongoDB',
      version: connectionInfo.version,
      region: 'external',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: input.connection.host,
      port: input.connection.port,
      databaseName: input.connection.database,
      username: input.connection.user,
      passwordEncrypted: encryptSecret(input.connection.password),
      ssl: Boolean(input.connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Подключён MongoDB',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Connected to MongoDB ${input.connection.host}:${input.connection.port}/${input.connection.database}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CONNECTED, `Подключена БД «${input.name}»`, `MongoDB · проект «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'MongoDB',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function registerExistingMysql(userId: string, input: {
  projectId: string;
  name: string;
  connection: MysqlConnectionInput;
  tags?: string[];
}) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Подключать внешние базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  const connectionInfo = await testMysqlConnection(input.connection);
  const connectionString = getConnectionString(input.connection, 'mysql');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'MySQL',
      version: connectionInfo.version,
      region: 'external',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: input.connection.host,
      port: input.connection.port,
      databaseName: input.connection.database,
      username: input.connection.user,
      passwordEncrypted: encryptSecret(input.connection.password),
      ssl: Boolean(input.connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Подключён MySQL',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Connected to MySQL ${input.connection.host}:${input.connection.port}/${input.connection.database}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CONNECTED, `Подключена БД «${input.name}»`, `MySQL · проект «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'MySQL',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function createManagedPostgresDatabase(
  userId: string,
  input: { projectId: string; name: string; tags?: string[]; initialSql?: string | null },
) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Создавать управляемые базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  const databaseName = slugifyDatabaseName(input.name, 'db');
  const ownerUser = randomDbUser('u');
  const ownerPassword = randomDbPassword();

  await provisionDatabase({ admin: platformPgConfig, databaseName, ownerUser, ownerPassword });

  const connection: PostgresConnectionInput = {
    host: platformPgConfig.host,
    port: platformPgConfig.port,
    database: databaseName,
    user: ownerUser,
    password: ownerPassword,
    ssl: platformPgConfig.ssl,
  };

  const initialSql = parseOptionalInitialSql(input.initialSql);
  if (initialSql) {
    try {
      await runSql(connection, initialSql, []);
    } catch (error: unknown) {
      try {
        await dropPostgresManagedDatabase(platformPgConfig, databaseName, ownerUser);
      } catch {
        /* ignore rollback errors */
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, explainDbRuntimeError('postgres', error));
    }
  }

  const versionInfo = await testConnection(connection);
  const connectionString = getConnectionString(connection, 'postgres');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'PostgreSQL',
      version: versionInfo.version,
      region: 'managed',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: connection.host,
      port: connection.port,
      databaseName: connection.database,
      username: connection.user,
      passwordEncrypted: encryptSecret(connection.password),
      ssl: Boolean(connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Создана управляемая PostgreSQL',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Created managed PostgreSQL ${databaseName}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CREATED, `Создана БД «${input.name}»`, `PostgreSQL на платформе · «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'PostgreSQL',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function createManagedMongoDatabase(
  userId: string,
  input: { projectId: string; name: string; tags?: string[]; initialSql?: string | null },
) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Создавать управляемые базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  if (input.initialSql != null && String(input.initialSql).trim()) {
    throw new HttpError(400, 'Импорт SQL при создании поддерживается только для PostgreSQL и MySQL.');
  }

  const databaseName = slugifyDatabaseName(input.name, 'mongo');
  const ownerUser = randomDbUser('m');
  const ownerPassword = randomDbPassword();

  await provisionMongoDatabase({
    admin: platformMongoConfig,
    databaseName,
    ownerUser,
    ownerPassword,
  });

  const connection: MongoConnectionInput = {
    host: platformMongoConfig.host,
    port: platformMongoConfig.port,
    database: databaseName,
    user: ownerUser,
    password: ownerPassword,
    ssl: platformMongoConfig.ssl,
  };

  const versionInfo = await testMongoConnection(connection);
  const connectionString = getConnectionString(connection, 'mongodb');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'MongoDB',
      version: versionInfo.version,
      region: 'managed',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: connection.host,
      port: connection.port,
      databaseName: connection.database,
      username: connection.user,
      passwordEncrypted: encryptSecret(connection.password),
      ssl: Boolean(connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Создана управляемая MongoDB',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Created managed MongoDB ${databaseName}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CREATED, `Создана БД «${input.name}»`, `MongoDB на платформе · «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'MongoDB',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function createManagedMysqlDatabase(
  userId: string,
  input: { projectId: string; name: string; tags?: string[]; initialSql?: string | null },
) {
  const member = await requireProjectRole(input.projectId, userId, UserRole.ADMIN, 'Создавать управляемые базы могут только администраторы проекта');
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new HttpError(404, 'Проект не найден.');

  const databaseName = slugifyDatabaseName(input.name, 'mysql');
  const ownerUser = randomDbUser('sql');
  const ownerPassword = randomDbPassword();

  await provisionMysqlDatabase({
    admin: platformMysqlConfig,
    databaseName,
    ownerUser,
    ownerPassword,
  });

  const connection: MysqlConnectionInput = {
    host: platformMysqlConfig.host,
    port: platformMysqlConfig.port,
    database: databaseName,
    user: ownerUser,
    password: ownerPassword,
    ssl: platformMysqlConfig.ssl,
  };

  const initialSql = parseOptionalInitialSql(input.initialSql);
  if (initialSql) {
    try {
      await runMysqlMigrationSql(connection, initialSql);
    } catch (error: unknown) {
      try {
        await dropMysqlManagedDatabase(platformMysqlConfig, databaseName, ownerUser);
      } catch {
        /* ignore rollback errors */
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, explainDbRuntimeError('mysql', error));
    }
  }

  const versionInfo = await testMysqlConnection(connection);
  const connectionString = getConnectionString(connection, 'mysql');

  const database = await prisma.managedDatabase.create({
    data: {
      name: input.name,
      engine: 'MySQL',
      version: versionInfo.version,
      region: 'managed',
      status: DatabaseStatus.RUNNING,
      projectId: project.id,
      connectionStringMasked: maskConnectionString(connectionString),
      host: connection.host,
      port: connection.port,
      databaseName: connection.database,
      username: connection.user,
      passwordEncrypted: encryptSecret(connection.password),
      ssl: Boolean(connection.ssl),
      tagsJson: JSON.stringify(input.tags ?? []),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'Создана управляемая MySQL',
      resource: input.name,
      userId,
      userName: await getUserName(userId),
      details: `Created managed MySQL ${databaseName}`,
    },
  });

  await notifyUser(userId, NotificationType.DATABASE_CREATED, `Создана БД «${input.name}»`, `MySQL на платформе · «${project.name}»`, {
    databaseId: database.id,
    projectId: project.id,
    projectName: project.name,
    databaseName: input.name,
    engine: 'MySQL',
  });

  return { ...(await toPublicDatabase(database as any)), myProjectRole: member.role.toLowerCase() };
}

export async function migrateManagedSqlEngine(
  userId: string,
  databaseId: string,
  targetEngine: 'postgresql' | 'mysql',
) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Менять СУБД могут только администраторы проекта');
  if (database.region !== 'managed') {
    throw new HttpError(400, 'Смена СУБД доступна только для управляемых баз МояБД.');
  }
  const current = normalizeEngine(database.engine);
  if (current === 'mongodb') {
    throw new HttpError(400, 'Переход с MongoDB этим способом не поддерживается.');
  }
  const targetNorm = targetEngine === 'mysql' ? 'mysql' : 'postgres';
  if (current === targetNorm) {
    throw new HttpError(400, 'База уже на выбранной СУБД.');
  }

  assertDatabaseReadyForWork(database);

  const preservedConstructorJson = database.constructorStateJson;

  const snapshot = await buildFullBackupPayload(database as any);
  const converted = convertSqlBackupPayloadForEngine(
    snapshot as Record<string, unknown>,
    targetNorm === 'mysql' ? 'mysql' : 'postgresql',
  );

  await prisma.managedDatabase.update({
    where: { id: database.id },
    data: { status: DatabaseStatus.MIGRATING },
  });

  let oldDropped = false;
  try {
    await prisma.backup.deleteMany({ where: { databaseId: database.id } });
    await prisma.migration.deleteMany({ where: { databaseId: database.id } });

    try {
      if (current === 'postgres') {
        await dropPostgresManagedDatabase(platformPgConfig, database.databaseName, database.username);
      } else {
        await dropMysqlManagedDatabase(platformMysqlConfig, database.databaseName, database.username);
      }
    } catch (dropErr: unknown) {
      const msg = dropErr instanceof Error ? dropErr.message : String(dropErr);
      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: { status: DatabaseStatus.RUNNING },
      });
      throw new HttpError(400, `Не удалось удалить старый инстанс: ${msg}`);
    }
    oldDropped = true;

    const databaseName = slugifyDatabaseName(database.name, targetNorm === 'mysql' ? 'mysql' : 'db');
    const ownerUser = randomDbUser(targetNorm === 'mysql' ? 'sql' : 'u');
    const ownerPassword = randomDbPassword();

    if (targetNorm === 'mysql') {
      await provisionMysqlDatabase({
        admin: platformMysqlConfig,
        databaseName,
        ownerUser,
        ownerPassword,
      });
      const connection: MysqlConnectionInput = {
        host: platformMysqlConfig.host,
        port: platformMysqlConfig.port,
        database: databaseName,
        user: ownerUser,
        password: ownerPassword,
        ssl: platformMysqlConfig.ssl,
      };
      await restoreMysqlBackupPayload(connection, converted);
      const versionInfo = await testMysqlConnection(connection);
      const connectionString = getConnectionString(connection, 'mysql');
      const freshSchema = await exportMysqlConstructorSchema(connection);
      const constructorStateJson = computeConstructorStateJsonAfterSqlRestore(freshSchema, preservedConstructorJson);

      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: {
          engine: 'MySQL',
          version: versionInfo.version,
          host: connection.host,
          port: connection.port,
          databaseName: connection.database,
          username: connection.user,
          passwordEncrypted: encryptSecret(connection.password),
          ssl: Boolean(connection.ssl),
          connectionStringMasked: maskConnectionString(connectionString),
          status: DatabaseStatus.RUNNING,
          constructorStateJson,
        },
      });
    } else {
      await provisionDatabase({
        admin: platformPgConfig,
        databaseName,
        ownerUser,
        ownerPassword,
      });
      const connection: PostgresConnectionInput = {
        host: platformPgConfig.host,
        port: platformPgConfig.port,
        database: databaseName,
        user: ownerUser,
        password: ownerPassword,
        ssl: platformPgConfig.ssl,
      };
      await restorePostgresBackupPayload(connection, converted);
      const versionInfo = await testConnection(connection);
      const connectionString = getConnectionString(connection, 'postgres');
      const freshSchema = await exportConstructorSchema(connection);
      const constructorStateJson = computeConstructorStateJsonAfterSqlRestore(freshSchema, preservedConstructorJson);

      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: {
          engine: 'PostgreSQL',
          version: versionInfo.version,
          host: connection.host,
          port: connection.port,
          databaseName: connection.database,
          username: connection.user,
          passwordEncrypted: encryptSecret(connection.password),
          ssl: Boolean(connection.ssl),
          connectionStringMasked: maskConnectionString(connectionString),
          status: DatabaseStatus.RUNNING,
          constructorStateJson,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: 'Смена SQL СУБД',
        resource: database.name,
        userId,
        userName: await getUserName(userId),
        details: `Переход ${current} → ${targetNorm}, новое имя БД на платформе: ${databaseName}`,
      },
    });

    return await getDatabase(userId, databaseId);
  } catch (error: unknown) {
    if (oldDropped) {
      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: { status: DatabaseStatus.ERROR },
      });
    }
    throw error;
  }
}

export async function deleteDatabase(userId: string, databaseId: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Удалять базу может только администратор проекта');
  const engine = normalizeEngine(database.engine);

  if (database.region === 'managed') {
    try {
      if (engine === 'postgres') {
        await dropPostgresManagedDatabase(platformPgConfig, database.databaseName, database.username);
      } else if (engine === 'mysql') {
        await dropMysqlManagedDatabase(platformMysqlConfig, database.databaseName, database.username);
      } else if (engine === 'mongodb') {
        await dropMongoManagedDatabase(platformMongoConfig, database.databaseName);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpError(400, `Не удалось удалить инстанс на платформе: ${msg}`);
    }
  }

  await prisma.managedDatabase.delete({ where: { id: database.id } });

  await prisma.auditLog.create({
    data: {
      action: database.region === 'managed' ? 'Удалена управляемая база' : 'Удалено подключение',
      resource: database.name,
      userId,
      userName: await getUserName(userId),
      details:
        database.region === 'managed'
          ? `Удалена управляемая БД ${engine}: ${database.databaseName}`
          : `Удалено подключение «${database.name}» (ваша БД на сервере не трогалась)`,
    },
  });

  return { deleted: true };
}

export async function getSchema(userId: string, databaseId: string) {
  const database = await requireDatabaseForUser(databaseId, userId);
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      return listMongoCollections(getDecryptedConnection(database) as MongoConnectionInput);
    }
    if (engine === 'mysql') {
      return listMysqlSchema(getDecryptedConnection(database) as MysqlConnectionInput);
    }
    return listSchema(getDecryptedConnection(database) as PostgresConnectionInput);
  });
}

export async function getTableRows(userId: string, databaseId: string, table: string, limit: number, offset: number) {
  const database = await requireDatabaseForUser(databaseId, userId);
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      return getMongoCollectionData(getDecryptedConnection(database) as MongoConnectionInput, table, limit, offset);
    }
    if (engine === 'mysql') {
      return getMysqlTableData(getDecryptedConnection(database) as MysqlConnectionInput, table, limit, offset);
    }
    return getTableData(getDecryptedConnection(database) as PostgresConnectionInput, table, limit, offset);
  });
}

export async function executeSql(userId: string, databaseId: string, sql: string, values: unknown[] = []) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может выполнять SQL');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') {
    throw new HttpError(400, 'Для MongoDB используйте вкладки «Структура» и «Документы», а не SQL.');
  }
  return withReadableDbError(engine, async () => {
    if (engine === 'mysql') {
      return runMysqlSql(getDecryptedConnection(database) as MysqlConnectionInput, sql, values);
    }
    return runSql(getDecryptedConnection(database) as PostgresConnectionInput, sql, values);
  });
}

export async function createRow(userId: string, databaseId: string, table: string, data: Record<string, unknown>) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может менять данные');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      return insertMongoDocument(getDecryptedConnection(database) as MongoConnectionInput, table, data);
    }
    if (engine === 'mysql') {
      return insertMysqlRow(getDecryptedConnection(database) as MysqlConnectionInput, table, data);
    }
    return insertRow(getDecryptedConnection(database) as PostgresConnectionInput, table, data);
  });
}

export async function patchRow(userId: string, databaseId: string, table: string, pkColumn: string, pkValue: unknown, patch: Record<string, unknown>) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может менять данные');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      return updateMongoDocument(getDecryptedConnection(database) as MongoConnectionInput, table, pkValue, patch);
    }
    if (engine === 'mysql') {
      return updateMysqlRow(getDecryptedConnection(database) as MysqlConnectionInput, table, pkColumn, pkValue, patch);
    }
    return updateRow(getDecryptedConnection(database) as PostgresConnectionInput, table, pkColumn, pkValue, patch);
  });
}

export async function removeRow(userId: string, databaseId: string, table: string, pkColumn: string, pkValue: unknown) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может менять данные');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      return deleteMongoDocument(getDecryptedConnection(database) as MongoConnectionInput, table, pkValue);
    }
    if (engine === 'mysql') {
      return deleteMysqlRow(getDecryptedConnection(database) as MysqlConnectionInput, table, pkColumn, pkValue);
    }
    return deleteRow(getDecryptedConnection(database) as PostgresConnectionInput, table, pkColumn, pkValue);
  });
}

export async function truncateTable(userId: string, databaseId: string, tableParam: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может очищать таблицы или коллекции');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  return withReadableDbError(engine, async () => {
    if (engine === 'mongodb') {
      const collection = assertSafeMongoCollectionName(tableParam);
      return clearMongoCollection(getDecryptedConnection(database) as MongoConnectionInput, collection);
    }
    assertSafeTableName(tableParam);
    if (engine === 'mysql') {
      await truncateMysqlTable(getDecryptedConnection(database) as MysqlConnectionInput, tableParam);
      return { truncated: true as const };
    }
    await truncatePublicTable(getDecryptedConnection(database) as PostgresConnectionInput, tableParam);
    return { truncated: true as const };
  });
}

export async function getConstructor(userId: string, databaseId: string) {
  const database = await requireDatabaseForUser(databaseId, userId);
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') {
    throw new HttpError(400, 'Для MongoDB откройте вкладки структуры и коллекций — SQL-конструктор здесь не используется.');
  }
  const conn = getDecryptedConnection(database);
  return withReadableDbError(engine, async () => {
    const schema =
      engine === 'mysql'
        ? await exportMysqlConstructorSchema(conn as MysqlConnectionInput)
        : await exportConstructorSchema(conn as PostgresConnectionInput);
    const current = readConstructorState((database as any).constructorStateJson);
    const nextState = pruneConstructorState(current, schema.tables.map((table) => table.name));

    if (JSON.stringify(current) !== JSON.stringify(nextState)) {
      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: { constructorStateJson: JSON.stringify(nextState) } as any,
      });
    }

    return mergeConstructorState(schema, nextState);
  });
}

export async function saveConstructorLayout(userId: string, databaseId: string, input: ConstructorState) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Менять раскладку диаграммы может редактор или выше');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') {
    throw new HttpError(400, 'Для MongoDB раскладку на ER-диаграмме сохранять не нужно — используйте обзор коллекций.');
  }
  const conn = getDecryptedConnection(database);
  return withReadableDbError(engine, async () => {
    const schema =
      engine === 'mysql'
        ? await exportMysqlConstructorSchema(conn as MysqlConnectionInput)
        : await exportConstructorSchema(conn as PostgresConnectionInput);
    const current = readConstructorState((database as any).constructorStateJson);
    const allowedNames = schema.tables.map((table) => table.name);

    let tableColorsMerged: Record<string, string> | undefined = undefined;
    if (input.tableColors !== undefined) {
      tableColorsMerged = {};
      for (const name of allowedNames) {
        const c = input.tableColors[name];
        if (c && String(c).trim()) tableColorsMerged[name] = String(c);
      }
    } else {
      tableColorsMerged = current.tableColors;
    }

    const next: ConstructorState = pruneConstructorState({
      layout: input.layout ?? current.layout ?? {},
      viewport: input.viewport ?? current.viewport,
      tableColors: tableColorsMerged,
    }, allowedNames);

    await prisma.managedDatabase.update({
      where: { id: database.id },
      data: { constructorStateJson: JSON.stringify(next) } as any,
    });
    return { saved: true };
  });
}

export async function applyConstructor(userId: string, databaseId: string, schema: ConstructorSchema) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Применять схему из конструктора могут только администраторы проекта');
  assertDatabaseReadyForWork(database);
  const engine = normalizeEngine(database.engine);
  if (engine === 'mongodb') {
    throw new HttpError(400, 'Конструктор таблиц для MongoDB не предусмотрен — меняйте коллекции через интерфейс.');
  }
  const conn = getDecryptedConnection(database);
  return withReadableDbError(engine, async () => {
    if (engine === 'mysql') {
      await applyMysqlConstructorSchema(conn as MysqlConnectionInput, schema);
      const freshSchema = await exportMysqlConstructorSchema(conn as MysqlConnectionInput);
      const nextState = pruneConstructorState(buildConstructorState(schema), freshSchema.tables.map((table) => table.name));
      await prisma.managedDatabase.update({
        where: { id: database.id },
        data: { constructorStateJson: JSON.stringify(nextState) } as any,
      });
      return { applied: true };
    }

    await applyConstructorSchema(conn as PostgresConnectionInput, schema);
    const freshSchema = await exportConstructorSchema(conn as PostgresConnectionInput);
    const nextState = pruneConstructorState(buildConstructorState(schema), freshSchema.tables.map((table) => table.name));

    await prisma.managedDatabase.update({
      where: { id: database.id },
      data: { constructorStateJson: JSON.stringify(nextState) } as any,
    });
    return { applied: true };
  });
}

export async function getMongoVisualState(userId: string, databaseId: string) {
  const database = await requireDatabaseForUser(databaseId, userId);
  assertDatabaseReadyForWork(database);
  if (normalizeEngine(database.engine) !== 'mongodb') {
    throw new HttpError(400, 'Это не MongoDB — визуальная схема доступна только для MongoDB.');
  }
  return withReadableDbError('mongodb', async () =>
    getMongoVisual(getDecryptedConnection(database) as MongoConnectionInput),
  );
}

export async function createMongoCollectionForUser(userId: string, databaseId: string, name: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может создавать коллекции');
  assertDatabaseReadyForWork(database);
  if (normalizeEngine(database.engine) !== 'mongodb') {
    throw new HttpError(400, 'Создавать коллекции можно только в базе MongoDB.');
  }
  return withReadableDbError('mongodb', async () =>
    createMongoCollection(getDecryptedConnection(database) as MongoConnectionInput, name),
  );
}

export async function deleteMongoCollectionForUser(userId: string, databaseId: string, name: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Удалять коллекции может только администратор проекта');
  assertDatabaseReadyForWork(database);
  if (normalizeEngine(database.engine) !== 'mongodb') {
    throw new HttpError(400, 'Удалять коллекции можно только в базе MongoDB.');
  }
  return withReadableDbError('mongodb', async () =>
    deleteMongoCollection(getDecryptedConnection(database) as MongoConnectionInput, name),
  );
}

export async function exportBackupPayloadForDatabase(database: Awaited<ReturnType<typeof requireDatabaseForUser>>) {
  if (normalizeEngine(database.engine) === 'mongodb') {
    return exportMongoBackupPayload(getDecryptedConnection(database) as MongoConnectionInput);
  }
  if (normalizeEngine(database.engine) === 'mysql') {
    return exportMysqlBackupPayload(getDecryptedConnection(database) as MysqlConnectionInput);
  }
  const { exportBackupPayload } = await import('../../adapters/postgres/adapter.js');
  return exportBackupPayload(getDecryptedConnection(database) as PostgresConnectionInput);
}

export async function restoreBackupPayloadForDatabase(database: Awaited<ReturnType<typeof requireDatabaseForUser>>, payload: any) {
  if (normalizeEngine(database.engine) === 'mongodb') {
    return restoreMongoBackupPayload(getDecryptedConnection(database) as MongoConnectionInput, payload);
  }
  if (normalizeEngine(database.engine) === 'mysql') {
    return restoreMysqlBackupPayload(getDecryptedConnection(database) as MysqlConnectionInput, payload);
  }
  const { restoreBackupPayload } = await import('../../adapters/postgres/adapter.js');
  return restoreBackupPayload(getDecryptedConnection(database) as PostgresConnectionInput, payload);
}

/** Полный снимок для бэкапа: данные как раньше + мета + логическая схема (таблицы, связи, позиции ER из платформы). */
export async function buildFullBackupPayload(database: Awaited<ReturnType<typeof requireDatabaseForUser>>) {
  const base = await exportBackupPayloadForDatabase(database);
  const engine = normalizeEngine(database.engine);
  const meta = {
    backupFormatVersion: 2,
    exportedAt: new Date().toISOString(),
    platformEngine: database.engine,
    logicalDatabaseName: database.databaseName,
  };

  if (engine === 'mongodb') {
    return {
      ...meta,
      ...base,
      logicalSchema: {
        kind: 'mongodb' as const,
        collections: (base.collections ?? []).map((c: { name: string; indexes?: unknown[] }) => ({
          name: c.name,
          indexes: c.indexes ?? [],
        })),
      },
    };
  }

  const conn = getDecryptedConnection(database);
  const liveSchema =
    engine === 'mysql'
      ? await exportMysqlConstructorSchema(conn as MysqlConnectionInput)
      : await exportConstructorSchema(conn as PostgresConnectionInput);
  const state = readConstructorState(database.constructorStateJson);
  const pruned = pruneConstructorState(state, liveSchema.tables.map((t) => t.name));
  const merged = mergeConstructorState(liveSchema, pruned);

  return {
    ...meta,
    ...base,
    logicalSchema: {
      kind: 'sql' as const,
      tables: merged.tables,
      relations: merged.relations ?? [],
      viewport: merged.viewport,
    },
  };
}
