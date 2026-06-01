import type { Database, Project, Backup, MigrationJob, AuditEntry, Plan, TeamMember, User, DatabaseConnectionInfo, NotificationRecord } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'dataisland_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('dataisland_user');
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    clearSession();
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Не удалось выполнить запрос' }));
    throw new Error(error.message ?? 'Не удалось выполнить запрос');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function fetchCurrentUser(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const result = await apiRequest<{ user: User | null }>('/auth/me');
    return result.user;
  } catch {
    clearSession();
    return null;
  }
}

export async function loginUser(email: string, password: string): Promise<User> {
  const result = await apiRequest<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(result.token);
  return result.user;
}

export async function signupUser(name: string, email: string, password: string): Promise<User> {
  const result = await apiRequest<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
  setToken(result.token);
  return result.user;
}

export async function fetchProjects(): Promise<Project[]> {
  return apiRequest<Project[]>('/projects');
}

export async function fetchProject(id: string): Promise<Project | undefined> {
  try {
    return await apiRequest<Project>(`/projects/${id}`);
  } catch {
    return undefined;
  }
}

export async function createProject(input: { name: string; description?: string }): Promise<Project> {
  return apiRequest<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchProjectMembers(projectId: string): Promise<TeamMember[]> {
  return apiRequest<TeamMember[]>(`/projects/${projectId}/members`);
}

export async function createProjectInvite(
  projectId: string,
  role?: 'EDITOR' | 'VIEWER',
): Promise<{ token: string; expiresAt: string }> {
  return apiRequest(`/projects/${projectId}/invites`, {
    method: 'POST',
    body: JSON.stringify(role ? { role } : {}),
  });
}

export async function previewProjectInvitePublic(token: string): Promise<{ projectName: string; role: string; expiresAt: string }> {
  const response = await fetch(`${API_URL}/project-invites/${encodeURIComponent(token)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Приглашение недействительно');
  }
  return response.json();
}

export async function acceptProjectInvite(token: string): Promise<{ ok: boolean; alreadyMember?: boolean; projectId: string }> {
  return apiRequest(`/project-invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
  });
}

export async function addProjectMemberByUsername(
  projectId: string,
  username: string,
  role?: 'EDITOR' | 'VIEWER',
): Promise<{ ok: boolean; userId: string }> {
  return apiRequest(`/projects/${projectId}/members/by-username`, {
    method: 'POST',
    body: JSON.stringify({ username, ...(role ? { role } : {}) }),
  });
}

export async function fetchNotifications(limit = 50): Promise<NotificationRecord[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiRequest<NotificationRecord[]>(`/notifications?${q}`);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const r = await apiRequest<{ count: number }>('/notifications/unread-count');
  return r.count;
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return apiRequest('/notifications/read-all', { method: 'POST' });
}

export async function updateProjectMemberRole(
  projectId: string,
  memberUserId: string,
  role: 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER',
): Promise<{ ok: boolean }> {
  return apiRequest(`/projects/${projectId}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeProjectMember(projectId: string, memberUserId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/projects/${projectId}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'DELETE',
  });
}

export async function moveDatabaseToProject(databaseId: string, projectId: string): Promise<Database> {
  return apiRequest<Database>(`/databases/${databaseId}/project`, {
    method: 'PATCH',
    body: JSON.stringify({ projectId }),
  });
}

export async function updateProfile(input: { name?: string; username?: string | null }): Promise<User> {
  const result = await apiRequest<{ user: User }>('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return result.user;
}

export async function fetchDatabases(): Promise<Database[]> {
  return apiRequest<Database[]>('/databases');
}

export async function fetchDatabase(id: string): Promise<Database | undefined> {
  return apiRequest<Database>(`/databases/${id}`);
}

export async function deleteDatabase(dbId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/databases/${dbId}`, { method: 'DELETE' });
}

export async function migrateManagedSqlEngine(
  dbId: string,
  body: { targetEngine: 'postgresql' | 'mysql' },
): Promise<Database> {
  return apiRequest<Database>(`/databases/${dbId}/migrate-sql-engine`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function syncManagedDatabaseHealth(dbId: string): Promise<Database> {
  return apiRequest<Database>(`/databases/${dbId}/sync-health`, { method: 'POST' });
}

export async function fetchDatabaseConnectionInfo(id: string): Promise<DatabaseConnectionInfo> {
  return apiRequest<DatabaseConnectionInfo>(`/databases/${id}/connection`);
}

export async function registerPostgresDatabase(input: {
  projectId: string;
  name: string;
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  tags?: string[];
}): Promise<Database> {
  return apiRequest<Database>('/databases/postgres/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createManagedPostgresDatabase(input: {
  projectId: string;
  name: string;
  tags?: string[];
  /** Опционально: выполнить SQL сразу после создания (PostgreSQL). */
  initialSql?: string;
}): Promise<Database> {
  return apiRequest<Database>('/databases/postgres/provision-managed', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type SchemaTable = {
  name: string;
  columns: number;
  rows: number;
  size: string;
};

export async function fetchSchema(dbId: string): Promise<SchemaTable[]> {
  return apiRequest<SchemaTable[]>(`/databases/${dbId}/schema`);
}


export type ConstructorSchema = {
  tables: Array<{
    id?: string;
    name: string;
    x?: number;
    y?: number;
    color?: string;
    columns: Array<{
      id?: string;
      name: string;
      type: string;
      primaryKey?: boolean;
      nullable?: boolean;
      unique?: boolean;
      defaultValue?: string | null;
    }>;
  }>;
  relations?: Array<{
    id?: string;
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
  }>;
  viewport?: {
    zoom: number;
    panX: number;
    panY: number;
  };
  tableColors?: Record<string, string>;
};

export async function fetchConstructor(dbId: string): Promise<ConstructorSchema> {
  return apiRequest<ConstructorSchema>(`/databases/${dbId}/constructor`);
}

export async function applyConstructor(dbId: string, schema: ConstructorSchema): Promise<{ applied: boolean }> {
  return apiRequest<{ applied: boolean }>(`/databases/${dbId}/constructor/apply`, {
    method: 'POST',
    body: JSON.stringify(schema),
  });
}

export async function saveConstructorLayout(dbId: string, input: {
  layout: Record<string, { x: number; y: number }>;
  viewport?: { zoom: number; panX: number; panY: number };
  tableColors?: Record<string, string>;
}): Promise<{ saved: boolean }> {
  return apiRequest<{ saved: boolean }>(`/databases/${dbId}/constructor/layout`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type TableDataResult = {
  columns: string[];
  rows: Record<string, any>[];
};

export async function fetchTableData(dbId: string, table: string, limit = 50, offset = 0): Promise<TableDataResult> {
  return apiRequest<TableDataResult>(`/databases/${dbId}/data/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`);
}

export async function insertTableRow(dbId: string, table: string, data: Record<string, unknown>) {
  return apiRequest<Record<string, unknown>>(`/databases/${dbId}/tables/${encodeURIComponent(table)}/rows`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}

export async function updateTableRow(dbId: string, table: string, pkColumn: string, pkValue: unknown, patch: Record<string, unknown>) {
  return apiRequest<Record<string, unknown> | null>(`/databases/${dbId}/tables/${encodeURIComponent(table)}/rows`, {
    method: 'PATCH',
    body: JSON.stringify({ pkColumn, pkValue, patch }),
  });
}

export async function deleteTableRow(dbId: string, table: string, pkColumn: string, pkValue: unknown) {
  return apiRequest<{ deleted: number }>(`/databases/${dbId}/tables/${encodeURIComponent(table)}/rows`, {
    method: 'DELETE',
    body: JSON.stringify({ pkColumn, pkValue }),
  });
}

/** Удалить все строки таблицы (TRUNCATE для SQL; для MongoDB — deleteMany по коллекции). */
export async function truncateDatabaseTable(dbId: string, table: string): Promise<{ truncated: true } | { deleted: number }> {
  return apiRequest<{ truncated: true } | { deleted: number }>(
    `/databases/${dbId}/tables/${encodeURIComponent(table)}/truncate`,
    { method: 'POST' },
  );
}

export async function runQuery(dbId: string, query: string): Promise<{ columns: string[]; rows: Record<string, any>[] }> {
  return apiRequest(`/databases/${dbId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql: query, values: [] }),
  });
}

export async function fetchBackups(dbId: string): Promise<Backup[]> {
  return apiRequest<Backup[]>(`/databases/${dbId}/backups`);
}

export async function createBackup(dbId: string): Promise<Backup> {
  return apiRequest<Backup>(`/databases/${dbId}/backups`, { method: 'POST' });
}

export async function restoreBackup(dbId: string, backupId: string): Promise<{ restored: boolean }> {
  return apiRequest<{ restored: boolean }>(`/databases/${dbId}/backups/${backupId}/restore`, { method: 'POST' });
}

export async function deleteBackup(dbId: string, backupId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/databases/${dbId}/backups/${backupId}`, { method: 'DELETE' });
}

export function getBackupDownloadUrl(dbId: string, backupId: string): string {
  const url = new URL(`${API_URL}/databases/${dbId}/backups/${backupId}/download`);
  const token = getToken();
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

export async function downloadBackup(dbId: string, backupId: string, filename = `backup-${backupId}.json`) {
  const response = await fetch(`${API_URL}/databases/${dbId}/backups/${backupId}/download`, {
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Download failed' }));
    throw new Error(error.message ?? 'Download failed');
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

/** SQL-файл из сохранённого JSON-бэкапа: только DDL или DDL+INSERT. Для MongoDB недоступно. */
export async function downloadBackupSql(dbId: string, backupId: string, includeData: boolean, filename: string) {
  const qs = includeData ? '?data=1' : '?data=0';
  const response = await fetch(`${API_URL}/databases/${dbId}/backups/${backupId}/export-sql${qs}`, {
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Export failed' }));
    throw new Error(error.message ?? 'Export failed');
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

export async function fetchMigrations(dbId: string): Promise<MigrationJob[]> {
  return apiRequest<MigrationJob[]>(`/databases/${dbId}/migrations`);
}

export async function applyMigration(dbId: string, input: { name: string; sql: string }) {
  return apiRequest(`/databases/${dbId}/migrations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchAuditLog(): Promise<AuditEntry[]> {
  return apiRequest<AuditEntry[]>('/audit');
}

export async function fetchPlans(): Promise<Plan[]> {
  return apiRequest<Plan[]>('/billing/plans');
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  return apiRequest<TeamMember[]>('/team');
}


export type MongoVisualField = {
  name: string;
  types: string[];
  required: boolean;
  frequency: number;
  children?: MongoVisualField[];
};

export type MongoVisualCollection = {
  name: string;
  documents: number;
  sizeBytes: number;
  validation: Record<string, unknown> | null;
  indexes: Array<{
    name: string;
    key: Record<string, number>;
    unique: boolean;
    sparse: boolean;
    expireAfterSeconds: number | null;
  }>;
  fields: MongoVisualField[];
};

export type MongoVisualState = {
  collections: MongoVisualCollection[];
  references: Array<{
    fromCollection: string;
    field: string;
    toCollection: string;
    kind: string;
  }>;
};

export async function registerMongoDatabase(input: {
  projectId: string;
  name: string;
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  tags?: string[];
}): Promise<Database> {
  return apiRequest<Database>('/databases/mongodb/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createManagedMongoDatabase(input: {
  projectId: string;
  name: string;
  tags?: string[];
  /** Не используется для MongoDB; поле для единообразия форм. */
  initialSql?: string;
}): Promise<Database> {
  return apiRequest<Database>('/databases/mongodb/provision-managed', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function registerMysqlDatabase(input: {
  projectId: string;
  name: string;
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  tags?: string[];
}): Promise<Database> {
  return apiRequest<Database>('/databases/mysql/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createManagedMysqlDatabase(input: {
  projectId: string;
  name: string;
  tags?: string[];
  /** Опционально: выполнить SQL сразу после создания (MySQL, несколько выражений через `;`). */
  initialSql?: string;
}): Promise<Database> {
  return apiRequest<Database>('/databases/mysql/provision-managed', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchMongoVisual(dbId: string): Promise<MongoVisualState> {
  return apiRequest<MongoVisualState>(`/databases/${dbId}/mongo/visual`);
}

export async function createMongoCollection(dbId: string, name: string): Promise<{ created: boolean }> {
  return apiRequest<{ created: boolean }>(`/databases/${dbId}/mongo/collections`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteMongoCollection(dbId: string, name: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/databases/${dbId}/mongo/collections/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
