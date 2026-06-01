import type { Database, Project, Backup, MigrationJob, AuditEntry, TeamMember, Plan, User } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('dataisland_token');
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message ?? 'Request failed');
  }

  return response.json();
}

export async function fetchProjects(): Promise<Project[]> {
  return api<Project[]>('/projects');
}

export async function fetchProject(id: string): Promise<Project | undefined> {
  const projects = await fetchProjects();
  return projects.find((project) => project.id === id);
}

export async function fetchDatabases(): Promise<Database[]> {
  return api<Database[]>('/databases');
}

export async function fetchDatabase(id: string): Promise<Database | undefined> {
  return api<Database>(`/databases/${id}`);
}

export async function fetchBackups(dbId: string): Promise<Backup[]> {
  return api<Backup[]>(`/databases/${dbId}/backups`);
}

export async function fetchAuditLog(): Promise<AuditEntry[]> {
  return api<AuditEntry[]>('/audit');
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  return api<TeamMember[]>('/team');
}

export async function fetchPlans(): Promise<Plan[]> {
  return api<Plan[]>('/billing/plans');
}

export async function runQuery(dbId: string, query: string): Promise<{ columns: string[]; rows: Record<string, any>[] }> {
  return api(`/databases/${dbId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql: query, values: [] }),
  });
}

export async function loginUser(email: string, password: string): Promise<User> {
  const result = await api<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem('dataisland_token', result.token);
  return result.user;
}

export async function signupUser(name: string, email: string, password: string): Promise<User> {
  const result = await api<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
  localStorage.setItem('dataisland_token', result.token);
  return result.user;
}

export async function fetchMigrations(dbId: string): Promise<MigrationJob[]> {
  return api<MigrationJob[]>(`/databases/${dbId}/migrations`);
}
