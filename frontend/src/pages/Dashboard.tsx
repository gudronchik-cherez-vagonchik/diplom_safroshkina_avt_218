import { useEffect, useMemo, useState } from 'react';
import { Database, FolderKanban, Shield, AlertTriangle, Plus, Link2, ArrowRightLeft, Terminal, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchDatabases, fetchAuditLog, fetchProjects, fetchBackups } from '@/services/api';
import type { AuditEntry, Backup, Database as DbType, Project } from '@/types';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';

const quickActions = [
  { label: 'Создать БД', icon: Plus, path: '/databases?create=true' },
  { label: 'Подключить существующую', icon: Link2, path: '/databases?create=true' },
  { label: 'SQL-редактор', icon: Terminal, path: '/databases' },
  { label: 'Проекты', icon: ArrowRightLeft, path: '/projects' },
];

export default function Dashboard() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [databases, setDatabases] = useState<DbType[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([fetchAuditLog(), fetchDatabases(), fetchProjects()])
      .then(async ([auditEntries, databaseList, projectList]) => {
        setAudit(auditEntries);
        setDatabases(databaseList);
        setProjects(projectList);
        const backupResults = await Promise.all(databaseList.slice(0, 5).map(db => fetchBackups(db.id).catch(() => [])));
        setBackups(backupResults.flat());
      })
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const running = databases.filter(db => db.status === 'running').length;
    const failed = databases.filter(db => db.status === 'error').length;
    return [
      { label: 'Всего БД', value: String(databases.length), icon: Database, trend: `${running} активных` },
      { label: 'Проекты', value: String(projects.length), icon: FolderKanban, trend: 'Организация данных' },
      { label: 'Бэкапы', value: String(backups.length), icon: Shield, trend: backups[0] ? `Последний: ${new Date(backups[0].createdAt).toLocaleDateString('ru-RU')}` : 'Пока нет' },
      { label: 'Ошибки', value: String(failed), icon: AlertTriangle, trend: failed ? 'Требуют внимания' : 'Всё стабильно' },
    ];
  }, [backups, databases, projects]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Дашборд</h1>
        <p className="text-muted-foreground mt-1">Обзор проектов, баз данных и последних действий.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="bg-card rounded-2xl p-5 shadow-card border border-border hover:shadow-card-hover transition-shadow duration-300"
            >
              <div className="flex gap-4 items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-foreground shadow-inner">
                  <Icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold text-foreground tabular-nums">{loading ? '—' : s.value}</p>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.trend}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">Последние действия</h2>
          </div>
          <div className="space-y-3 max-h-[min(420px,45vh)] overflow-y-auto pr-1 -mr-1">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded-lg" />
                  <div className="flex-1"><Skeleton className="h-4 w-3/4 mb-1" /><Skeleton className="h-3 w-1/2" /></div>
                </div>
              ))
            ) : audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет событий.</p>
            ) : (
              audit.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Database className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{entry.action} — {entry.resource}</p>
                    <p className="text-xs text-muted-foreground">{entry.user} · {new Date(entry.timestamp).toLocaleString('ru-RU')}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-card p-5">
          <h2 className="font-semibold text-foreground mb-4">Быстрые действия</h2>
          <div className="space-y-2">
            {quickActions.map(a => (
              <button
                key={a.label}
                onClick={() => navigate(a.path)}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <a.icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground flex-1">{a.label}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground">Ваши базы данных</h2>
          <Button variant="outline-primary" size="sm" onClick={() => navigate('/databases')}>
            Все <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Название</th>
                <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">СУБД</th>
                <th className="text-left py-2 px-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {databases.slice(0, 5).map(db => (
                <tr
                  key={db.id}
                  className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/databases/${db.id}`)}
                >
                  <td className="py-2.5 px-3 font-medium text-foreground">{db.name}</td>
                  <td className="py-2.5 px-3 text-muted-foreground hidden sm:table-cell">{db.engine}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={db.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
