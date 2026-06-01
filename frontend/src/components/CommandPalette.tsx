import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Search, Database, FolderKanban, LayoutDashboard, Users, UserRound, Bell, Plus, ArrowRight, Loader2 } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDatabases, fetchProjects } from '@/services/api';
import type { Database as DbRecord, Project } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const navigation = [
  { label: 'Перейти на Дашборд', icon: LayoutDashboard, path: '/', hints: 'dashboard главная' },
  { label: 'Перейти в Проекты', icon: FolderKanban, path: '/projects', hints: 'project список' },
  { label: 'Перейти в Базы данных', icon: Database, path: '/databases', hints: 'бд sql mongo список баз' },
  { label: 'Перейти в Уведомления', icon: Bell, path: '/notifications', hints: 'приглашения события inbox' },
  { label: 'Перейти в Профиль', icon: UserRound, path: '/profile', hints: 'username настройки кабинет' },
  { label: 'Перейти в Команду', icon: Users, path: '/team', hints: 'участники' },
  { label: 'Создать новую БД', icon: Plus, path: '/databases?create=true', hints: 'добавить базу подключить' },
  { label: 'Создать новый проект', icon: Plus, path: '/projects?create=true', hints: 'новый проект' },
];

function normalizeQuery(q: string) {
  return q.trim().toLowerCase();
}

function haystackIncludes(haystack: string, q: string) {
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

export default function CommandPalette({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState('');
  const [databases, setDatabases] = useState<DbRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }
    let cancelled = false;
    setLoadingLists(true);
    Promise.all([fetchDatabases(), fetchProjects()])
      .then(([dbs, projs]) => {
        if (!cancelled) {
          setDatabases(dbs);
          setProjects(projs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDatabases([]);
          setProjects([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const q = useMemo(() => normalizeQuery(search), [search]);

  const navFiltered = useMemo(
    () =>
      navigation.filter((item) =>
        haystackIncludes(`${item.label} ${item.path} ${item.hints}`, q),
      ),
    [q],
  );

  const dbFiltered = useMemo(
    () =>
      databases.filter((db) =>
        haystackIncludes(`${db.name} ${db.engine} ${db.region ?? ''} база бд database sql mongo postgres mysql`, q),
      ),
    [databases, q],
  );

  const projFiltered = useMemo(
    () => projects.filter((p) => haystackIncludes(`${p.name} проект project`, q)),
    [projects, q],
  );

  const totalMatches = navFiltered.length + dbFiltered.length + projFiltered.length;

  const handleSelect = (path: string) => {
    navigate(path);
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 rounded-2xl overflow-hidden border-border">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Разделы, базы, проекты…"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="shrink-0 px-2 py-0.5 rounded-md bg-secondary border border-border text-xs text-muted-foreground">ESC</kbd>
        </div>
        <div className="max-h-[min(420px,55vh)] overflow-auto p-2">
          {loadingLists && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Загрузка списков…
            </div>
          )}
          {!loadingLists && totalMatches === 0 && (
            <p className="text-center py-8 text-sm text-muted-foreground">Ничего не найдено</p>
          )}
          {!loadingLists && navFiltered.length > 0 && (
            <div className="mb-2">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Разделы</p>
              {navFiltered.map((item) => (
                <button
                  key={item.path + item.label}
                  type="button"
                  onClick={() => handleSelect(item.path)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  <item.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
          {!loadingLists && dbFiltered.length > 0 && (
            <div className="mb-2">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Базы данных</p>
              {dbFiltered.map((db) => (
                <button
                  key={db.id}
                  type="button"
                  onClick={() => handleSelect(`/databases/${db.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-left min-w-0">
                    <span className="block truncate font-medium">{db.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{db.engine}</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
          {!loadingLists && projFiltered.length > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Проекты</p>
              {projFiltered.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => handleSelect(`/projects/${project.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  <FolderKanban className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-left truncate font-medium">{project.name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
