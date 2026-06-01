import { FastifyInstance } from 'fastify';
import { authGuard } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };

    const entries = await prisma.auditLog.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      resource: entry.resource,
      user: entry.userName,
      timestamp: entry.createdAt.toISOString(),
      details: entry.details ?? undefined,
    }));
  });
}
