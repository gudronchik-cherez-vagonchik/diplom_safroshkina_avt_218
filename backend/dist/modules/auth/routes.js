import { z } from 'zod';
import { registerUser, loginUser, updateUserProfile } from './service.js';
import { authGuard, getCurrentUser } from '../../lib/auth.js';
const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});
const profileSchema = z.object({
    name: z.string().min(2).optional(),
    username: z.union([z.string(), z.null()]).optional(),
});
function mapRole(role) {
    return String(role).toLowerCase();
}
function mapUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: mapRole(user.role),
    };
}
export async function authRoutes(app) {
    app.post('/register', async (request, reply) => {
        const body = registerSchema.parse(request.body);
        const user = await registerUser(body);
        const token = await reply.jwtSign({ sub: user.id, email: user.email });
        return {
            token,
            user: mapUser(user),
        };
    });
    app.post('/login', async (request, reply) => {
        const body = loginSchema.parse(request.body);
        const user = await loginUser(body);
        const token = await reply.jwtSign({ sub: user.id, email: user.email });
        return {
            token,
            user: mapUser(user),
        };
    });
    app.get('/me', { preHandler: authGuard }, async (request) => {
        const user = await getCurrentUser(request);
        if (!user)
            return { user: null };
        return {
            user: mapUser(user),
        };
    });
    app.patch('/profile', { preHandler: authGuard }, async (request) => {
        const payload = request.user;
        const body = profileSchema.parse(request.body ?? {});
        const updated = await updateUserProfile(payload.sub, body);
        return { user: mapUser(updated) };
    });
}
