import { useEffect, useState } from 'react';
import { Database as DbIcon, Plus, RefreshCw, Search, Shield, Terminal } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  createManagedMongoDatabase,
  createManagedMysqlDatabase,
  createManagedPostgresDatabase,
  fetchDatabases,
  fetchProjects,
  registerMongoDatabase,
  registerMysqlDatabase,
  registerPostgresDatabase,
} from '@/services/api';
import type { Database, Project } from '@/types';

type EngineChoice = 'postgres' | 'mongodb' | 'mysql';

function dbCardIconShellClass(engine: string) {
  if (engine === 'MongoDB') {
    return 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 shadow-sm dark:border-emerald-500/35 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (engine === 'MySQL' || engine === 'MariaDB') {
    return 'border-amber-500/25 bg-amber-500/[0.08] text-amber-900 shadow-sm dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-200';
  }
  return 'border-sky-500/25 bg-sky-500/[0.07] text-sky-900 shadow-sm dark:border-sky-500/35 dark:bg-sky-950/35 dark:text-sky-200';
}

const emptyManaged = {
  projectId: '',
  name: '',
  engine: 'postgres' as EngineChoice,
  initialSql: '',
};

const emptyRegister = {
  projectId: '',
  name: '',
  engine: 'postgres' as EngineChoice,
  host: '127.0.0.1',
  port: '5432',
  database: '',
  user: 'postgres',
  password: '',
  ssl: false,
};

export default function Databases() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [mode, setMode] = useState<'managed' | 'register'>('managed');
  const [managedForm, setManagedForm] = useState(emptyManaged);
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const load = async () => {
    setLoading(true);
    try {
      const [dbs, projs] = await Promise.all([fetchDatabases(), fetchProjects()]);
      setDatabases(dbs);
      setProjects(projs);
      const defaultProjectId = projs[0]?.id ?? '';
      setManagedForm((prev) => ({ ...prev, projectId: prev.projectId || defaultProjectId }));
      setRegisterForm((prev) => ({ ...prev, projectId: prev.projectId || defaultProjectId }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const create = searchParams.get('create') === 'true';
    const pid = searchParams.get('projectId');
    if (pid) {
      setManagedForm((prev) => ({ ...prev, projectId: pid }));
      setRegisterForm((prev) => ({ ...prev, projectId: pid }));
    }
    if (create) {
      setCreateOpen(true);
    }
    if (create || pid) {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('projectId');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filtered = databases.filter((db) => db.name.toLowerCase().includes(search.toLowerCase()));

  const syncDefaultsForEngine = (engine: EngineChoice) => {
    setRegisterForm((prev) => ({
      ...prev,
      engine,
      port: engine === 'mongodb' ? '27017' : engine === 'mysql' ? '3306' : '5432',
      user: engine === 'mongodb' ? 'root' : engine === 'mysql' ? 'root' : 'postgres',
    }));
    setManagedForm((prev) => ({ ...prev, engine, initialSql: engine === 'mongodb' ? '' : prev.initialSql }));
  };

  const handleManagedCreate = async () => {
    setSaving(true);
    try {
      if (managedForm.engine === 'mongodb') {
        await createManagedMongoDatabase({ projectId: managedForm.projectId, name: managedForm.name });
        toast({ title: 'MongoDB создана', description: 'Платформа создала managed MongoDB и сохранила доступ.' });
      } else if (managedForm.engine === 'mysql') {
        await createManagedMysqlDatabase({
          projectId: managedForm.projectId,
          name: managedForm.name,
          initialSql: managedForm.initialSql.trim() || undefined,
        });
        toast({ title: 'MySQL создана', description: 'Платформа создала managed MySQL и сохранила доступ.' });
      } else {
        await createManagedPostgresDatabase({
          projectId: managedForm.projectId,
          name: managedForm.name,
          initialSql: managedForm.initialSql.trim() || undefined,
        });
        toast({ title: 'База создана', description: 'Платформа автоматически создала PostgreSQL и сохранила доступ.' });
      }
      setCreateOpen(false);
      setManagedForm({ ...emptyManaged, projectId: projects[0]?.id ?? '' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось создать БД', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRegister = async () => {
    setSaving(true);
    try {
      const payload = {
        projectId: registerForm.projectId,
        name: registerForm.name,
        connection: {
          host: registerForm.host,
          port: Number(registerForm.port),
          database: registerForm.database,
          user: registerForm.user,
          password: registerForm.password,
          ssl: registerForm.ssl,
        },
      };
      if (registerForm.engine === 'mongodb') {
        await registerMongoDatabase(payload);
        toast({ title: 'MongoDB подключена', description: 'Существующая MongoDB зарегистрирована.' });
      } else if (registerForm.engine === 'mysql') {
        await registerMysqlDatabase(payload);
        toast({ title: 'MySQL подключена', description: 'Существующая MySQL зарегистрирована.' });
      } else {
        await registerPostgresDatabase(payload);
        toast({ title: 'PostgreSQL подключена', description: 'Существующая PostgreSQL зарегистрирована.' });
      }
      setCreateOpen(false);
      setRegisterForm({ ...emptyRegister, projectId: projects[0]?.id ?? '' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось подключить БД', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Базы данных</h1>
          <p className="text-muted-foreground mt-1">{databases.length} баз данных во всех проектах</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Обновить</Button>
          <Button variant="hero" size="sm" onClick={() => setCreateOpen(true)} disabled={projects.length === 0}><Plus className="w-4 h-4" /> Добавить БД</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Поиск баз данных…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl h-10" />
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={DbIcon} title="Баз данных пока нет" description={projects.length === 0 ? 'Сначала создайте проект.' : 'Создайте управляемую БД или подключите существующую.'} actionLabel={projects.length === 0 ? 'Открыть проекты' : 'Добавить БД'} onAction={() => projects.length === 0 ? navigate('/projects?create=true') : setCreateOpen(true)} />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((db) => (
            <div key={db.id} className="bg-card rounded-2xl border border-border shadow-card hover:shadow-card-hover transition-all duration-300 p-5 cursor-pointer group" onClick={() => navigate(`/databases/${db.id}`)}>
              <div className="flex gap-4 items-start">
                <div
                  className={cn(
                    'flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl border',
                    dbCardIconShellClass(db.engine),
                  )}
                  aria-hidden
                >
                  <DbIcon className="h-6 w-6" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1 flex flex-col gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">{db.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                      {db.engine}
                      {db.version ? ` · ${db.version}` : ''}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div><p>Хранилище</p><p className="text-foreground mt-1 font-medium">{db.storage}</p></div>
                    <div><p>Подключения</p><p className="text-foreground mt-1 font-medium">{db.connections}</p></div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-foreground">
                      <Terminal className="w-3 h-3 shrink-0" strokeWidth={2} />
                      {db.engine === 'MongoDB' ? 'Документы' : 'SQL'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-foreground">
                      <Shield className="w-3 h-3 shrink-0" strokeWidth={2} />
                      Бэкапы
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[min(90vh,760px)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-xl sm:max-w-xl">
          <div className="shrink-0 border-b border-border bg-muted/40 px-6 py-5">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle className="text-xl">Добавить БД</DialogTitle>
              <p className="text-sm font-normal text-muted-foreground">Выберите систему управления базами и способ добавления</p>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="db-engine" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                СУБД
              </Label>
              <select
                id="db-engine"
                value={mode === 'managed' ? managedForm.engine : registerForm.engine}
                onChange={(e) => syncDefaultsForEngine(e.target.value as EngineChoice)}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Режим</span>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setMode('managed')}
                  className={cn(
                    'rounded-lg px-2 py-2.5 text-center text-sm font-medium transition-all sm:px-3',
                    mode === 'managed'
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  Создать автоматически
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={cn(
                    'rounded-lg px-2 py-2.5 text-center text-sm font-medium transition-all sm:px-3',
                    mode === 'register'
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  Подключить существующую
                </button>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {mode === 'managed' ? 'Параметры новой базы' : 'Параметры подключения'}
              </p>

              {mode === 'managed' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="managed-project">Проект</Label>
                    <select
                      id="managed-project"
                      value={managedForm.projectId}
                      onChange={(e) => setManagedForm((prev) => ({ ...prev, projectId: e.target.value }))}
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-name">Название базы</Label>
                    <Input
                      id="managed-name"
                      value={managedForm.name}
                      onChange={(e) => setManagedForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={
                        managedForm.engine === 'mongodb'
                          ? 'Например: analytics'
                          : managedForm.engine === 'mysql'
                            ? 'Например: shop-db'
                            : 'Например: main-app'
                      }
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-initial-sql">Начальный SQL (необязательно)</Label>
                    <Textarea
                      id="managed-initial-sql"
                      value={managedForm.initialSql}
                      onChange={(e) => setManagedForm((prev) => ({ ...prev, initialSql: e.target.value }))}
                      placeholder={'-- Выполнится сразу после создания БД (PostgreSQL).\nCREATE TABLE …'}
                      disabled={managedForm.engine === 'mongodb'}
                      className="min-h-[120px] rounded-xl font-mono text-xs"
                      spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      {managedForm.engine === 'mongodb'
                        ? 'Импорт SQL при создании поддерживается только для PostgreSQL и MySQL.'
                        : managedForm.engine === 'mysql'
                          ? 'Допускается несколько выражений через точку с запятой. При ошибке создание отменится.'
                          : 'Можно вставить дамп или DDL. При ошибке выполнения управляемая БД на платформе будет удалена.'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                    {managedForm.engine === 'mongodb'
                      ? 'Платформа сама создаст MongoDB database и пользователя и выдаст строку подключения.'
                      : managedForm.engine === 'mysql'
                        ? 'Платформа создаст базу MySQL, пользователя с правами на неё и выдаст строку подключения.'
                        : 'Платформа создаст PostgreSQL, сгенерирует пользователя и пароль и выдаст строку подключения.'}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reg-project">Проект</Label>
                    <select
                      id="reg-project"
                      value={registerForm.projectId}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, projectId: e.target.value }))}
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reg-name">Имя подключения</Label>
                    <Input
                      id="reg-name"
                      value={registerForm.name}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={
                        registerForm.engine === 'mongodb'
                          ? 'existing-mongo'
                          : registerForm.engine === 'mysql'
                            ? 'existing-mysql'
                            : 'existing-postgres'
                      }
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-host">Host</Label>
                    <Input id="reg-host" value={registerForm.host} onChange={(e) => setRegisterForm((prev) => ({ ...prev, host: e.target.value }))} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-port">Port</Label>
                    <Input id="reg-port" value={registerForm.port} onChange={(e) => setRegisterForm((prev) => ({ ...prev, port: e.target.value }))} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reg-database">{registerForm.engine === 'mongodb' ? 'Database / Auth DB' : 'Database'}</Label>
                    <Input id="reg-database" value={registerForm.database} onChange={(e) => setRegisterForm((prev) => ({ ...prev, database: e.target.value }))} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reg-user">User</Label>
                    <Input id="reg-user" value={registerForm.user} onChange={(e) => setRegisterForm((prev) => ({ ...prev, user: e.target.value }))} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reg-password">Password</Label>
                    <Input id="reg-password" type="password" value={registerForm.password} onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))} className="h-11 rounded-xl" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/25 px-6 py-4 sm:flex-row sm:justify-end sm:gap-3">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button variant="hero" className="w-full sm:w-auto" disabled={saving} onClick={mode === 'managed' ? handleManagedCreate : handleRegister}>
              {saving ? 'Сохраняем...' : mode === 'managed' ? 'Создать БД' : 'Подключить БД'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
