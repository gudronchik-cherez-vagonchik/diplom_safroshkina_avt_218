import crypto from 'node:crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http.js';
import { memberHasMinRole } from '../../lib/roles.js';
import { markInviteNotificationsRead, NotificationType, notifyUser } from '../notifications/service.js';
function roleInviteLabel(role) {
    switch (role) {
        case UserRole.OWNER:
            return 'владелец';
        case UserRole.ADMIN:
            return 'админ';
        case UserRole.VIEWER:
            return 'наблюдатель';
        case UserRole.EDITOR:
            return 'редактор';
        default:
            return role.toLowerCase();
    }
}
function mapListedProject(project) {
    return {
        id: project.id,
        name: project.name,
        description: project.description,
        databases: project.databases.length,
        members: project.members.length,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        environments: [{ name: 'production', status: 'running' }],
    };
}
export async function listProjects(userId) {
    const projects = await prisma.project.findMany({
        where: { members: { some: { userId } } },
        include: { databases: true, members: true },
        orderBy: { updatedAt: 'desc' },
    });
    return projects.map(mapListedProject);
}
export async function createProject(userId, input) {
    const project = await prisma.project.create({
        data: {
            name: input.name,
            description: input.description ?? '',
            members: {
                create: [{ userId, role: UserRole.OWNER }],
            },
        },
        include: { databases: true, members: true },
    });
    await notifyUser(userId, NotificationType.PROJECT_CREATED, `Проект «${project.name}» создан`, 'Можно добавить базы данных и пригласить участников.', { projectId: project.id, projectName: project.name });
    return mapListedProject(project);
}
export async function getProject(userId, projectId) {
    const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
    });
    if (!membership)
        throw new HttpError(404, 'Проект не найден или нет доступа');
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { databases: true, members: true },
    });
    return mapListedProject(project);
}
export async function listProjectMembers(requesterId, projectId) {
    const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: requesterId } },
    });
    if (!membership)
        throw new HttpError(404, 'Проект не найден');
    const rows = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { id: true, name: true, email: true, username: true } } },
        orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => ({
        id: r.user.id,
        name: r.user.name,
        email: r.user.email,
        username: r.user.username,
        role: r.role.toLowerCase(),
        joinedAt: r.joinedAt.toISOString(),
    }));
}
export async function createProjectInvite(actorUserId, projectId, role = UserRole.EDITOR, options) {
    const m = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actorUserId } },
    });
    if (!m || !memberHasMinRole(m.role, UserRole.ADMIN)) {
        throw new HttpError(403, 'Только владелец или администратор может создавать приглашения');
    }
    if (role !== UserRole.EDITOR && role !== UserRole.VIEWER) {
        throw new HttpError(400, 'В приглашении можно указать только роль редактора или наблюдателя');
    }
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.projectInvite.create({
        data: {
            token,
            projectId,
            role,
            createdByUserId: actorUserId,
            expiresAt,
            targetUserId: options?.targetUserId ?? null,
        },
    });
    const actor = await prisma.user.findUnique({ where: { id: actorUserId } });
    await prisma.auditLog.create({
        data: {
            action: 'Создано приглашение в проект',
            resource: projectId,
            userId: actorUserId,
            userName: actor?.name ?? 'Пользователь',
            details: `Срок: ${expiresAt.toISOString()}`,
        },
    });
    return { token, expiresAt: expiresAt.toISOString() };
}
export async function previewProjectInvite(token) {
    const invite = await prisma.projectInvite.findUnique({
        where: { token },
        include: { project: { select: { name: true } } },
    });
    if (!invite || invite.expiresAt < new Date()) {
        throw new HttpError(404, 'Приглашение не найдено или срок истёк');
    }
    return {
        projectName: invite.project.name,
        role: invite.role.toLowerCase(),
        expiresAt: invite.expiresAt.toISOString(),
    };
}
export async function acceptProjectInvite(userId, token) {
    const invite = await prisma.projectInvite.findUnique({
        where: { token },
    });
    if (!invite || invite.expiresAt < new Date()) {
        throw new HttpError(400, 'Приглашение недействительно или срок истёк');
    }
    const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: invite.projectId, userId } },
    });
    if (existing) {
        await prisma.projectInvite.delete({ where: { id: invite.id } }).catch(() => { });
        await markInviteNotificationsRead(userId, token);
        return { ok: true, alreadyMember: true, projectId: invite.projectId };
    }
    await prisma.projectMember.create({
        data: {
            projectId: invite.projectId,
            userId,
            role: invite.role,
        },
    });
    await prisma.projectInvite.delete({ where: { id: invite.id } });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const project = await prisma.project.findUnique({ where: { id: invite.projectId } });
    await prisma.auditLog.create({
        data: {
            action: 'Принято приглашение в проект',
            resource: project?.name ?? invite.projectId,
            userId,
            userName: user?.name ?? 'Пользователь',
            details: `projectId=${invite.projectId}`,
        },
    });
    await markInviteNotificationsRead(userId, token);
    return { ok: true, alreadyMember: false, projectId: invite.projectId };
}
export function normalizeUsernameInput(raw) {
    return raw.trim().toLowerCase();
}
/** Приглашение по username: участник получает уведомление и принимает приглашение на платформе или по ссылке; роль после вступления можно изменить в карточке проекта. */
export async function inviteProjectMemberByUsername(actorUserId, projectId, usernameRaw, role) {
    const m = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actorUserId } },
    });
    if (!m || !memberHasMinRole(m.role, UserRole.ADMIN)) {
        throw new HttpError(403, 'Только владелец или администратор может приглашать участников');
    }
    const normalized = normalizeUsernameInput(usernameRaw);
    if (!/^[a-z0-9_]{3,30}$/.test(normalized)) {
        throw new HttpError(400, 'Username: 3–30 символов, латиница, цифры и подчёркивание');
    }
    const target = await prisma.user.findUnique({ where: { username: normalized } });
    if (!target)
        throw new HttpError(404, 'Пользователь с таким username не найден');
    if (target.id === actorUserId) {
        throw new HttpError(400, 'Нельзя пригласить себя');
    }
    const existingMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: target.id } },
    });
    if (existingMember) {
        throw new HttpError(400, 'Пользователь уже в проекте');
    }
    await prisma.projectInvite.deleteMany({
        where: { projectId, targetUserId: target.id },
    });
    const { token, expiresAt } = await createProjectInvite(actorUserId, projectId, role, {
        targetUserId: target.id,
    });
    const actor = await prisma.user.findUnique({ where: { id: actorUserId } });
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    await notifyUser(target.id, NotificationType.PROJECT_INVITE, `Приглашение в проект «${project?.name ?? 'Проект'}»`, `${actor?.name ?? 'Участник'} пригласил вас как ${roleInviteLabel(role)}. Примите приглашение здесь или по ссылке от коллеги.`, {
        inviteToken: token,
        projectId,
        projectName: project?.name ?? '',
        role: role.toLowerCase(),
        invitedBy: actor?.name ?? '',
        expiresAt,
    });
    return { ok: true, userId: target.id };
}
export async function updateProjectMemberRole(actorUserId, projectId, targetUserId, newRole) {
    const actor = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actorUserId } },
    });
    if (!actor || !memberHasMinRole(actor.role, UserRole.ADMIN)) {
        throw new HttpError(403, 'Недостаточно прав для изменения ролей');
    }
    const target = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!target)
        throw new HttpError(404, 'Участник не найден');
    if (actor.role !== UserRole.OWNER) {
        if (target.role === UserRole.OWNER) {
            throw new HttpError(403, 'Администратор не может менять роль владельца');
        }
        if (newRole === UserRole.OWNER) {
            throw new HttpError(403, 'Только владелец может назначать владельцев');
        }
    }
    const ownerCount = await prisma.projectMember.count({
        where: { projectId, role: UserRole.OWNER },
    });
    if (target.role === UserRole.OWNER && newRole !== UserRole.OWNER && ownerCount <= 1) {
        throw new HttpError(400, 'В проекте должен остаться хотя бы один владелец');
    }
    if (target.role === newRole) {
        return { ok: true };
    }
    await prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId: targetUserId } },
        data: { role: newRole },
    });
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const actorUser = await prisma.user.findUnique({ where: { id: actorUserId } });
    await prisma.auditLog.create({
        data: {
            action: 'Изменена роль в проекте',
            resource: project?.name ?? projectId,
            userId: actorUserId,
            userName: actorUser?.name ?? 'Пользователь',
            details: `userId=${targetUserId} → ${newRole}`,
        },
    });
    await notifyUser(targetUserId, NotificationType.PROJECT_ROLE_CHANGED, `Роль в проекте «${project?.name ?? 'Проект'}»`, `Вам назначена роль: ${roleInviteLabel(newRole)}`, {
        projectId,
        projectName: project?.name ?? '',
        role: newRole.toLowerCase(),
    });
    return { ok: true };
}
export async function removeProjectMember(actorUserId, projectId, targetUserId) {
    const actor = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actorUserId } },
    });
    if (!actor || !memberHasMinRole(actor.role, UserRole.ADMIN)) {
        throw new HttpError(403, 'Недостаточно прав для исключения участников');
    }
    const target = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!target)
        throw new HttpError(404, 'Участник не найден');
    if (actor.role !== UserRole.OWNER && target.role === UserRole.OWNER) {
        throw new HttpError(403, 'Только владелец может исключить другого владельца');
    }
    const ownerCount = await prisma.projectMember.count({
        where: { projectId, role: UserRole.OWNER },
    });
    if (target.role === UserRole.OWNER && ownerCount <= 1) {
        throw new HttpError(400, 'Нельзя исключить единственного владельца проекта');
    }
    await prisma.projectMember.delete({
        where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const actorUser = await prisma.user.findUnique({ where: { id: actorUserId } });
    await prisma.auditLog.create({
        data: {
            action: 'Участник исключён из проекта',
            resource: project?.name ?? projectId,
            userId: actorUserId,
            userName: actorUser?.name ?? 'Пользователь',
            details: `Исключён userId=${targetUserId}`,
        },
    });
    await notifyUser(targetUserId, NotificationType.PROJECT_REMOVED, `Вас исключили из проекта «${project?.name ?? 'Проект'}»`, undefined, {
        projectId,
        projectName: project?.name ?? '',
    });
    return { ok: true };
}
