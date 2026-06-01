import { prisma } from './prisma.js';
export async function authGuard(request, reply) {
    try {
        await request.jwtVerify();
    }
    catch {
        return reply.code(401).send({ message: 'Нужно войти в аккаунт' });
    }
}
export async function getCurrentUser(request) {
    const payload = request.user;
    return prisma.user.findUnique({ where: { id: payload.sub } });
}
