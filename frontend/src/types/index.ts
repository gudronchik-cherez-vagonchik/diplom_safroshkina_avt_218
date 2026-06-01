export type DbEngine = 'PostgreSQL' | 'MySQL' | 'MariaDB' | 'MongoDB';
export type DbStatus = 'running' | 'stopped' | 'migrating' | 'error' | 'provisioning';
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface User {
  id: string;
  name: string;
  email: string;
  /** Логин для приглашений (латиница, цифры, _) */
  username?: string | null;
  avatar?: string;
  role: MemberRole;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  databases: number;
  members: number;
  createdAt: string;
  updatedAt: string;
  environments: { name: string; status: DbStatus }[];
}

export interface Database {
  id: string;
  name: string;
  engine: DbEngine;
  version: string;
  status: DbStatus;
  storage: string;
  connections: number;
  projectId: string;
  tags: string[];
  createdAt: string;
  connectionString: string;
  region?: string;
  /** Роль текущего пользователя в проекте этой БД (с бэкенда, lower-case). */
  myProjectRole?: MemberRole | string;
}

const PROJECT_ROLE_WEIGHT: Record<string, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/** Сравнение роли участника проекта с минимально нужной (viewer < editor < admin < owner). */
export function projectRoleAtLeast(role: string | undefined, minimum: MemberRole): boolean {
  const r = (role ?? 'viewer').toLowerCase();
  const w = PROJECT_ROLE_WEIGHT[r] ?? 1;
  return w >= PROJECT_ROLE_WEIGHT[minimum];
}

export interface Backup {
  id: string;
  databaseId: string;
  size: string;
  type: 'auto' | 'manual';
  status: 'completed' | 'in_progress' | 'failed';
  createdAt: string;
}

export interface MigrationJob {
  id: string;
  source: { engine: DbEngine; database: string };
  target: { engine: DbEngine; database: string };
  status: MigrationStatus;
  progress: number;
  logs: string[];
  createdAt: string;
  name?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  user: string;
  timestamp: string;
  details?: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  features: string[];
  current: boolean;
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role: MemberRole;
  avatar?: string;
  joinedAt: string;
}


export interface DatabaseConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  connectionString: string;
}
