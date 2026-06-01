import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http.js';
export async function registerUser(input) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing)
        throw new HttpError(409, 'Этот email уже зарегистрирован');
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
        data: {
            name: input.name,
            email: input.email,
            passwordHash,
            role: UserRole.OWNER,
        },
    });
    const project = await prisma.project.create({
        data: {
            name: `Проект ${input.name}`,
            description: 'Рабочее пространство по умолчанию',
            members: {
                create: [{ userId: user.id, role: UserRole.OWNER }],
            },
        },
    });
    await prisma.auditLog.create({
        data: {
            action: 'Регистрация пользователя',
            resource: project.name,
            userId: user.id,
            userName: user.name,
            details: `Создан проект ${project.id}`,
        },
    });
    return user;
}
export async function loginUser(input) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user)
        throw new HttpError(401, 'Неверный email или пароль');
    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid)
        throw new HttpError(401, 'Неверный email или пароль');
    return user;
}
export async function updateUserProfile(userId, input) {
    const data = {};
    if (input.name !== undefined) {
        const n = input.name.trim();
        if (n.length < 2)
            throw new HttpError(400, 'Имя слишком короткое');
        data.name = n;
    }
    if (input.username !== undefined) {
        if (input.username === null || input.username.trim() === '') {
            data.username = null;
        }
        else {
            const u = input.username.trim().toLowerCase();
            if (!/^[a-z0-9_]{3,30}$/.test(u)) {
                throw new HttpError(400, 'Username: от 3 до 30 символов, только латиница, цифры и подчёркивание');
            }
            const taken = await prisma.user.findFirst({
                where: { username: u, NOT: { id: userId } },
            });
            if (taken)
                throw new HttpError(409, 'Этот username уже занят');
            data.username = u;
        }
    }
    if (Object.keys(data).length === 0) {
        return prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    return prisma.user.update({
        where: { id: userId },
        data,
    });
}
