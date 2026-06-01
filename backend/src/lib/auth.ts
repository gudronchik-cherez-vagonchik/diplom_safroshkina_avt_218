import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: 'Нужно войти в аккаунт' });
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const payload = request.user as { sub: string; email: string };
  return prisma.user.findUnique({ where: { id: payload.sub } });
}
