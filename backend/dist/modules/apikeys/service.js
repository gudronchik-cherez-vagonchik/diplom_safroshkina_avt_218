import crypto from 'node:crypto';
import { ApiKeyStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http.js';
const KEY_PREFIX = 'moi_';
export function hashApiKey(secret) {
    return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}
function generateSecret() {
    return `${KEY_PREFIX}${crypto.randomBytes(28).toString('base64url')}`;
}
async function audit(userId, action, resource, details) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await prisma.auditLog.create({
        data: {
            action,
            resource,
            userId,
            userName: user?.name ?? 'Пользователь',
            details: details ?? null,
        },
    });
}
export async function createApiKey(userId, name) {
    const trimmed = name.trim();
    if (!trimmed)
        throw new HttpError(400, 'Укажите название ключа');
    if (trimmed.length > 80)
        throw new HttpError(400, 'Название ключа слишком длинное');
    const secret = generateSecret();
    const keyHash = hashApiKey(secret);
    const keyPrefix = secret.slice(0, 16);
    const row = await prisma.apiKey.create({
        data: {
            name: trimmed,
            userId,
            keyPrefix,
            keyHash,
            status: ApiKeyStatus.ACTIVE,
        },
    });
    await audit(userId, 'Создан API-ключ', trimmed, `Префикс: ${keyPrefix}…`);
    return {
        id: row.id,
        name: row.name,
        secret,
        createdAt: row.createdAt.toISOString(),
    };
}
export async function listApiKeys(userId) {
    const keys = await prisma.apiKey.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
    });
    return keys.map((key) => ({
        id: key.id,
        name: key.name,
        key: `${key.keyPrefix}…`,
        createdAt: key.createdAt.toISOString(),
        lastUsed: key.lastUsedAt?.toISOString() ?? 'never',
        status: key.status === ApiKeyStatus.ACTIVE ? 'active' : 'revoked',
    }));
}
export async function revokeApiKey(userId, keyId) {
    const existing = await prisma.apiKey.findFirst({ where: { id: keyId, userId } });
    if (!existing)
        throw new HttpError(404, 'Ключ не найден');
    await prisma.apiKey.update({
        where: { id: keyId },
        data: { status: ApiKeyStatus.REVOKED },
    });
    await audit(userId, 'Отозван API-ключ', existing.name);
}
/** Проверка ключа для внешнего API. Возвращает userId или null. */
export async function resolveApiKeyUser(secret) {
    const trimmed = secret.trim();
    if (!trimmed || trimmed.length < 20)
        return null;
    const keyHash = hashApiKey(trimmed);
    const key = await prisma.apiKey.findFirst({
        where: { keyHash, status: ApiKeyStatus.ACTIVE },
    });
    if (!key)
        return null;
    await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
    });
    return { userId: key.userId, keyId: key.id };
}
