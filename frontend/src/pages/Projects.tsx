import { useEffect, useState } from 'react';
import { Plus, Grid3X3, List, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createProject, fetchProjects } from '@/services/api';
import type { Project } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setCreateOpen(true);
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await createProject({ name: newName, description: newDesc });
      setProjects(prev => [created, ...prev]);
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      toast({ title: 'Проект создан', description: `"${created.name}" успешно создан.` });
    } catch (error: any) {
      toast({ title: 'Не удалось создать проект', description: error.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Проекты</h1>
          <p className="text-muted-foreground mt-1">Организуйте базы данных по проектам</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-secondary rounded-xl p-1">
            <button onClick={() => setView('cards')} className={`p-2 rounded-lg transition-colors ${view === 'cards' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button onClick={() => setView('table')} className={`p-2 rounded-lg transition-colors ${view === 'table' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button variant="hero" size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> Новый проект</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState icon={Grid3X3} title="Проектов пока нет" description="Создайте первый проект для организации баз данных." actionLabel="Создать проект" onAction={() => setCreateOpen(true)} />
      ) : view === 'cards' ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="bg-card rounded-2xl border border-border shadow-card hover:shadow-card-hover transition-all duration-300 p-5 cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{p.name}</h3>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{p.description}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><span className="font-medium text-foreground">{p.databases}</span> БД</span>
                <span className="flex items-center gap-1"><span className="font-medium text-foreground">{p.members}</span> участн.</span>
              </div>
              <div className="flex gap-2 mt-3">
                {p.environments.map(env => (
                  <StatusBadge key={env.name} status={env.status} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Название</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Описание</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">БД</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden sm:table-cell">Участники</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/30 cursor-pointer transition-colors" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td className="py-3 px-4 font-medium text-foreground">{p.name}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell truncate max-w-xs">{p.description}</td>
                  <td className="py-3 px-4 text-foreground">{p.databases}</td>
                  <td className="py-3 px-4 text-foreground hidden sm:table-cell">{p.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Новый проект</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Название проекта</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Мой проект" className="mt-1.5 rounded-xl" />
            </div>
            <div>
              <Label>Описание</Label>
              <Input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Краткое описание проекта" className="mt-1.5 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button variant="hero" onClick={handleCreate} disabled={creating}>{creating ? 'Создание...' : 'Создать'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
