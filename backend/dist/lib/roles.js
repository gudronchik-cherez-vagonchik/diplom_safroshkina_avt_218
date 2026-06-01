import { UserRole } from '@prisma/client';
const WEIGHT = {
    [UserRole.VIEWER]: 1,
    [UserRole.EDITOR]: 2,
    [UserRole.ADMIN]: 3,
    [UserRole.OWNER]: 4,
};
export function memberHasMinRole(role, minimum) {
    return WEIGHT[role] >= WEIGHT[minimum];
}
