import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import jwtPlugin from './plugins/jwt.js';
import { corsOrigins } from './config/env.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { projectsRoutes } from './modules/projects/routes.js';
import { databasesRoutes } from './modules/databases/routes.js';
import { backupsRoutes } from './modules/backups/routes.js';
import { migrationsRoutes } from './modules/migrations/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { teamRoutes } from './modules/team/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { projectInvitesRoutes } from './modules/projectInvites/routes.js';
import { notificationsRoutes } from './modules/notifications/routes.js';
import { HttpError } from './lib/http.js';
export function buildApp() {
    const app = Fastify({ logger: true });
    app.register(sensible);
    app.register(cors, {
        origin: corsOrigins,
        credentials: true,
    });
    app.register(jwtPlugin);
    app.register(healthRoutes, { prefix: '/health' });
    app.register(authRoutes, { prefix: '/auth' });
    app.register(projectsRoutes, { prefix: '/projects' });
    app.register(projectInvitesRoutes, { prefix: '/project-invites' });
    app.register(notificationsRoutes, { prefix: '/notifications' });
    app.register(databasesRoutes, { prefix: '/databases' });
    app.register(backupsRoutes, { prefix: '/databases' });
    app.register(migrationsRoutes, { prefix: '/databases' });
    app.register(auditRoutes, { prefix: '/audit' });
    app.register(teamRoutes, { prefix: '/team' });
    app.register(billingRoutes, { prefix: '/billing' });
    app.setErrorHandler((error, request, reply) => {
        if (error instanceof HttpError) {
            return reply.code(error.statusCode).send({ message: error.message });
        }
        if (error instanceof ZodError) {
            return reply.code(400).send({
                message: 'Проверьте поля формы',
                errors: error.format(),
            });
        }
        if (error.validation) {
            return reply.code(400).send({ message: 'Данные не прошли проверку', details: error.validation });
        }
        request.log.error(error);
        return reply.code(500).send({ message: error instanceof Error ? error.message : 'Внутренняя ошибка сервера' });
    });
    return app;
}
