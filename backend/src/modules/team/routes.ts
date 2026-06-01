import { FastifyInstance } from 'fastify';
import { authGuard } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

export async function teamRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const memberships = await prisma.projectMember.findMany({
      where: { userId: user.sub },
      include: { project: true },
    });

    if (memberships.length === 0) return [];

    const projectIds = memberships.map((membership) => membership.projectId);
    const members = await prisma.projectMember.findMany({
      where: { projectId: { in: projectIds } },
      include: { user: true },
    });

    const unique = new Map<string, any>();
    for (const member of members) {
      unique.set(member.user.id, {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        username: member.user.username,
        role: member.role.toLowerCase(),
        joinedAt: member.joinedAt.toISOString(),
      });
    }

    return [...unique.values()];
  });
}
