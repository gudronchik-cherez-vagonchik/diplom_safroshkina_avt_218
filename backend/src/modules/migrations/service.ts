import { MigrationStatus, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { runSql } from '../../adapters/postgres/adapter.js';
import { runMysqlMigrationSql } from '../../adapters/mysql/adapter.js';
import { HttpError } from '../../lib/http.js';
import { requireDatabaseProjectRole } from '../../lib/projectDbAccess.js';
import { getDecryptedConnection, assertDatabaseReadyForWork } from '../databases/service.js';
import { explainDbRuntimeError } from '../../lib/dbErrors.js';

function engineSupportsSqlMigrations(engine: string) {
  const e = engine.toLowerCase();
  return e.includes('postgres') || e.includes('mysql') || e.includes('mariadb');
}

function isMysqlFamily(engine: string) {
  const e = engine.toLowerCase();
  return e.includes('mysql') || e.includes('mariadb');
}

export async function listMigrations(userId: string, databaseId: string) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
  const migrations = await prisma.migration.findMany({
    where: { databaseId: database.id },
    orderBy: { createdAt: 'desc' },
  });

  const engineLabel = database.engine;

  return migrations.map((migration) => ({
    id: migration.id,
    source: { engine: engineLabel, database: database.name },
    target: { engine: engineLabel, database: database.name },
    status: migration.status.toLowerCase(),
    progress: migration.status === MigrationStatus.COMPLETED ? 100 : migration.status === MigrationStatus.FAILED ? 0 : 50,
    logs: JSON.parse(migration.logsJson),
    createdAt: migration.createdAt.toISOString(),
    name: migration.name,
  }));
}

export async function applyMigration(userId: string, databaseId: string, input: { name: string; sql: string }) {
  const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Применять SQL-миграции могут только администраторы проекта');
  assertDatabaseReadyForWork(database);

  if (!engineSupportsSqlMigrations(database.engine)) {
    throw new HttpError(400, 'SQL-миграции доступны только для PostgreSQL и MySQL.');
  }

  const migration = await prisma.migration.create({
    data: {
      databaseId: database.id,
      name: input.name,
      sql: input.sql,
      status: MigrationStatus.RUNNING,
      logsJson: JSON.stringify(['Миграция запущена']),
    },
  });

  try {
    if (isMysqlFamily(database.engine)) {
      await runMysqlMigrationSql(getDecryptedConnection(database), input.sql);
    } else {
      await runSql(getDecryptedConnection(database), input.sql);
    }
    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: {
        status: MigrationStatus.COMPLETED,
        logsJson: JSON.stringify(['Миграция запущена', 'Выполнено успешно']),
      },
    });
    return updated;
  } catch (error: unknown) {
    const friendly = explainDbRuntimeError(
      isMysqlFamily(database.engine) ? 'mysql' : 'postgres',
      error,
    );
    await prisma.migration.update({
      where: { id: migration.id },
      data: {
        status: MigrationStatus.FAILED,
        logsJson: JSON.stringify(['Миграция запущена', friendly]),
      },
    });
    throw new HttpError(400, friendly);
  }
}
