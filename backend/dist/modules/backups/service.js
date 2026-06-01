import { BackupStatus, BackupType, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { assertFound, HttpError } from '../../lib/http.js';
import { requireDatabaseProjectRole } from '../../lib/projectDbAccess.js';
import { assertDatabaseReadyForWork, buildFullBackupPayload, restoreBackupPayloadForDatabase, } from '../databases/service.js';
import { explainDbRuntimeErrorFromEngineLabel } from '../../lib/dbErrors.js';
import { buildMysqlSqlDump, buildPostgresSqlDump } from './sqlDump.js';
function sqlDumpEngine(engineLabel) {
    const e = engineLabel.toLowerCase();
    if (e.includes('mongo'))
        return 'mongodb';
    if (e.includes('mysql') || e.includes('mariadb'))
        return 'mysql';
    return 'postgres';
}
export async function listBackups(userId, databaseId) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
    const backups = await prisma.backup.findMany({
        where: { databaseId: database.id },
        orderBy: { createdAt: 'desc' },
    });
    return backups.map((backup) => ({
        id: backup.id,
        databaseId: backup.databaseId,
        size: backup.size,
        type: backup.type === BackupType.AUTO ? 'auto' : 'manual',
        status: backup.status === BackupStatus.IN_PROGRESS ? 'in_progress' : backup.status.toLowerCase(),
        createdAt: backup.createdAt.toISOString(),
    }));
}
export async function createBackup(userId, databaseId) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может создавать бэкапы');
    assertDatabaseReadyForWork(database);
    let payload;
    try {
        payload = await buildFullBackupPayload(database);
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(400, explainDbRuntimeErrorFromEngineLabel(database.engine, error));
    }
    const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    const backup = await prisma.backup.create({
        data: {
            databaseId: database.id,
            size: `${(size / 1024).toFixed(1)} KB`,
            type: BackupType.MANUAL,
            status: BackupStatus.COMPLETED,
            payloadJson: JSON.stringify(payload),
        },
    });
    return {
        id: backup.id,
        databaseId: backup.databaseId,
        size: backup.size,
        type: 'manual',
        status: 'completed',
        createdAt: backup.createdAt.toISOString(),
    };
}
export async function deleteBackup(userId, databaseId, backupId) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.EDITOR, 'Наблюдатель не может удалять бэкапы');
    const backup = assertFound(await prisma.backup.findFirst({ where: { id: backupId, databaseId: database.id } }), 'Бэкап не найден.');
    await prisma.backup.delete({ where: { id: backup.id } });
    return { deleted: true };
}
export async function restoreBackup(userId, databaseId, backupId) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.ADMIN, 'Восстанавливать бэкапы могут только администраторы проекта');
    assertDatabaseReadyForWork(database);
    const backup = assertFound(await prisma.backup.findFirst({ where: { id: backupId, databaseId: database.id } }), 'Бэкап не найден.');
    try {
        await restoreBackupPayloadForDatabase(database, JSON.parse(backup.payloadJson));
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(400, explainDbRuntimeErrorFromEngineLabel(database.engine, error));
    }
    return { restored: true };
}
export async function getBackupSqlExport(userId, databaseId, backupId, includeData) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
    const backup = assertFound(await prisma.backup.findFirst({ where: { id: backupId, databaseId: database.id } }), 'Бэкап не найден.');
    const eng = sqlDumpEngine(database.engine);
    if (eng === 'mongodb') {
        throw new HttpError(400, 'SQL-дамп доступен только для PostgreSQL и MySQL.');
    }
    const payload = JSON.parse(backup.payloadJson);
    const sql = eng === 'mysql' ? buildMysqlSqlDump(payload, includeData) : buildPostgresSqlDump(payload, includeData);
    const tag = includeData ? 'data' : 'schema';
    return {
        filename: `${database.name}-${tag}-${backup.createdAt.toISOString().replace(/[:.]/g, '-')}.sql`,
        content: sql,
    };
}
export async function getBackupDownload(userId, databaseId, backupId) {
    const { database } = await requireDatabaseProjectRole(databaseId, userId, UserRole.VIEWER);
    const backup = assertFound(await prisma.backup.findFirst({ where: { id: backupId, databaseId: database.id } }), 'Бэкап не найден.');
    return {
        filename: `${database.name}-${backup.createdAt.toISOString().replace(/[:.]/g, '-')}.json`,
        content: backup.payloadJson,
    };
}
