import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import {
  listNotifications,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from './service.js';

export async function notificationsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const q = z.object({ limit: z.coerce.number().min(1).max(100).optional() }).parse(request.query);
    return listNotifications(user.sub, q.limit ?? 50);
  });

  app.get('/unread-count', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const count = await unreadCount(user.sub);
    return { count };
  });

  app.patch('/:id/read', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return markNotificationRead(user.sub, params.id);
  });

  app.post('/read-all', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    return markAllNotificationsRead(user.sub);
  });
}
