import { z } from 'zod';
import { authGuard } from '../../lib/auth.js';
import { HttpError } from '../../lib/http.js';
import { acceptProjectInvite, previewProjectInvite } from '../projects/service.js';
export async function projectInvitesRoutes(app) {
    app.get('/:token', async (request, reply) => {
        const params = z.object({ token: z.string().min(10) }).parse(request.params);
        try {
            return await previewProjectInvite(params.token);
        }
        catch (error) {
            if (error instanceof HttpError && error.statusCode === 404) {
                return reply.code(404).send({ message: error.message });
            }
            throw error;
        }
    });
    app.post('/:token/accept', { preHandler: authGuard }, async (request) => {
        const user = request.user;
        const params = z.object({ token: z.string().min(10) }).parse(request.params);
        return acceptProjectInvite(user.sub, params.token);
    });
}
