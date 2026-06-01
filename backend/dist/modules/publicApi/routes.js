import { z } from 'zod';
import { apiKeyGuard } from '../../lib/apiKeyGuard.js';
import { prisma } from '../../lib/prisma.js';
import { listProjects } from '../projects/service.js';
import { getDatabase, listDatabases } from '../databases/service.js';
function apiUserId(request) {
    return request.apiKeyUserId;
}
export async function publicApiRoutes(app) {
    app.addHook('preHandler', apiKeyGuard);
    app.get('/me', async (request) => {
        const uid = apiUserId(request);
        const row = await prisma.user.findUnique({
            where: { id: uid },
            select: { id: true, email: true, name: true, role: true, createdAt: true },
        });
        return {
            id: row.id,
            email: row.email,
            name: row.name,
            role: row.role.toLowerCase(),
            createdAt: row.createdAt.toISOString(),
        };
    });
    app.get('/projects', async (request) => {
        return listProjects(apiUserId(request));
    });
    app.get('/databases', async (request) => {
        return listDatabases(apiUserId(request));
    });
    app.get('/databases/:id', async (request) => {
        const params = z.object({ id: z.string() }).parse(request.params);
        return getDatabase(apiUserId(request), params.id);
    });
}
