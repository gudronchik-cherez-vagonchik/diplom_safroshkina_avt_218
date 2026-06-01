import { prisma } from './prisma.js';
import { HttpError } from './http.js';
import { memberHasMinRole } from './roles.js';
/** Доступ к карточке БД с проверкой роли участника проекта. */
export async function requireDatabaseProjectRole(databaseId, userId, minimum, message = 'Недостаточно прав для этой операции') {
    const database = await prisma.managedDatabase.findFirst({
        where: {
            id: databaseId,
            project: { members: { some: { userId } } },
        },
    });
    if (!database) {
        throw new HttpError(404, 'База не найдена или у вас нет к ней доступа.');
    }
    const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: database.projectId, userId } },
    });
    if (!member || !memberHasMinRole(member.role, minimum)) {
        throw new HttpError(403, message);
    }
    return { database, role: member.role };
}
export async function requireProjectRole(projectId, userId, minimum, message = 'Недостаточно прав в этом проекте') {
    const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
    });
    if (!member || !memberHasMinRole(member.role, minimum)) {
        throw new HttpError(403, message);
    }
    return member;
}
