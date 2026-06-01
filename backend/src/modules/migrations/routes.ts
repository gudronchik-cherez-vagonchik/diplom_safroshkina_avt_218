import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { applyMigration, listMigrations } from './service.js';

const migrationSchema = z.object({
  name: z.string().min(2),
  sql: z.string().min(1),
});

export async function migrationsRoutes(app: FastifyInstance) {
  app.get('/:id/migrations', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return listMigrations(user.sub, params.id);
  });

  app.post('/:id/migrations', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = migrationSchema.parse(request.body);
    return applyMigration(user.sub, params.id, body);
  });
}
