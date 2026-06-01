import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { createBackup, deleteBackup, getBackupDownload, getBackupSqlExport, listBackups, restoreBackup } from './service.js';

export async function backupsRoutes(app: FastifyInstance) {
  app.get('/:id/backups', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return listBackups(user.sub, params.id);
  });

  app.post('/:id/backups', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return createBackup(user.sub, params.id);
  });

  app.get('/:id/backups/:backupId/export-sql', { preHandler: authGuard }, async (request, reply) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), backupId: z.string() }).parse(request.params);
    const query = z.object({ data: z.enum(['0', '1']).optional() }).parse(request.query);
    const includeData = query.data === '1';
    const file = await getBackupSqlExport(user.sub, params.id, params.backupId, includeData);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return reply.send(file.content);
  });

  app.get('/:id/backups/:backupId/download', { preHandler: authGuard }, async (request, reply) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), backupId: z.string() }).parse(request.params);
    const file = await getBackupDownload(user.sub, params.id, params.backupId);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return reply.send(file.content);
  });

  app.delete('/:id/backups/:backupId', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), backupId: z.string() }).parse(request.params);
    return deleteBackup(user.sub, params.id, params.backupId);
  });

  app.post('/:id/backups/:backupId/restore', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), backupId: z.string() }).parse(request.params);
    return restoreBackup(user.sub, params.id, params.backupId);
  });
}
