import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { UserRole } from '@prisma/client';
import {
  createProject,
  listProjects,
  getProject,
  listProjectMembers,
  createProjectInvite,
  inviteProjectMemberByUsername,
  updateProjectMemberRole,
  removeProjectMember,
} from './service.js';

const createSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

const inviteRoleSchema = z.enum(['EDITOR', 'VIEWER']).optional();

const inviteMemberRoleSchema = z.enum(['EDITOR', 'VIEWER']).optional();

const memberRoleUpdateSchema = z.enum(['VIEWER', 'EDITOR', 'ADMIN', 'OWNER']);

export async function projectsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    return listProjects(user.sub);
  });

  app.post('/', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const body = createSchema.parse(request.body);
    return createProject(user.sub, body);
  });

  app.get('/:id/members', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return listProjectMembers(user.sub, params.id);
  });

  app.patch('/:id/members/:userId', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    const body = z.object({ role: memberRoleUpdateSchema }).parse(request.body);
    const role = UserRole[body.role];
    return updateProjectMemberRole(user.sub, params.id, params.userId, role);
  });

  app.delete('/:id/members/:userId', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    return removeProjectMember(user.sub, params.id, params.userId);
  });

  app.post('/:id/invites', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ role: inviteRoleSchema }).parse(request.body ?? {});
    const role = body.role ? UserRole[body.role] : UserRole.EDITOR;
    return createProjectInvite(user.sub, params.id, role);
  });

  app.post('/:id/members/by-username', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      username: z.string().min(1),
      role: inviteMemberRoleSchema,
    }).parse(request.body);
    const role = body.role ? UserRole[body.role] : UserRole.EDITOR;
    return inviteProjectMemberByUsername(user.sub, params.id, body.username, role);
  });

  app.get('/:id', { preHandler: authGuard }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    return getProject(user.sub, params.id);
  });
}
