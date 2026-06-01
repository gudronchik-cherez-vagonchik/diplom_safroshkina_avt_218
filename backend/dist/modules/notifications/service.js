import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http.js';
export const NotificationType = {
    PROJECT_INVITE: 'project_invite',
    PROJECT_CREATED: 'project_created',
    PROJECT_REMOVED: 'project_removed',
    PROJECT_ROLE_CHANGED: 'project_role_changed',
    DATABASE_CREATED: 'database_created',
    DATABASE_CONNECTED: 'database_connected',
    DATABASE_MOVED: 'database_moved',
};
export async function notifyUser(userId, type, title, body, payload) {
    await prisma.notification.create({
        data: {
            userId,
            type,
            title,
            body: body ?? null,
            payloadJson: JSON.stringify(payload),
        },
    });
}
export async function markInviteNotificationsRead(userId, inviteToken) {
    const rows = await prisma.notification.findMany({
        where: { userId, type: NotificationType.PROJECT_INVITE, readAt: null },
        select: { id: true, payloadJson: true },
    });
    const now = new Date();
    for (const row of rows) {
        try {
            const p = JSON.parse(row.payloadJson);
            if (p.inviteToken === inviteToken) {
                await prisma.notification.update({
                    where: { id: row.id },
                    data: { readAt: now },
                });
            }
        }
        catch {
            /* ignore malformed payload */
        }
    }
}
function parsePayload(raw) {
    try {
        const v = JSON.parse(raw);
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}
export async function listNotifications(userId, limit) {
    const rows = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        read: Boolean(r.readAt),
        createdAt: r.createdAt.toISOString(),
        payload: parsePayload(r.payloadJson),
    }));
}
export async function unreadCount(userId) {
    return prisma.notification.count({
        where: { userId, readAt: null },
    });
}
export async function markNotificationRead(userId, notificationId) {
    const row = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
    });
    if (!row)
        throw new HttpError(404, 'Уведомление не найдено');
    if (!row.readAt) {
        await prisma.notification.update({
            where: { id: notificationId },
            data: { readAt: new Date() },
        });
    }
    return { ok: true };
}
export async function markAllNotificationsRead(userId) {
    await prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
    });
    return { ok: true };
}
