import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { createApiKey, listApiKeys, revokeApiKey } from './service.js';
const createSchema = z.object({
    name: z.string().min(1).max(80),
});
export async function apiKeysRoutes(app) {
    app.get('/', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        return listApiKeys(user.sub);
    });
    app.post('/', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const body = createSchema.parse(request.body);
        return createApiKey(user.sub, body.name);
    });
    app.delete('/:id', { preHandler: authGuard }, async (request, reply) => {
        const user = request.user;
        const params = z.object({ id: z.string() }).parse(request.params);
        await revokeApiKey(user.sub, params.id);
        return reply.code(204).send();
    });
}
