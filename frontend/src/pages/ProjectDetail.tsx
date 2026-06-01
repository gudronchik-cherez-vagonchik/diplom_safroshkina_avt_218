import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  fetchProject,
  fetchDatabases,
  fetchProjectMembers,
  createManagedMongoDatabase,
  createManagedMysqlDatabase,
  createManagedPostgresDatabase,
  createProjectInvite,
  moveDatabaseToProject,
  addProjectMemberByUsername,
  updateProjectMemberRole,
  removeProjectMember,
} from '@/services/api';
import type { Database, Project, TeamMember } from '@/types';
import { projectRoleAtLeast } from '@/types';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Users, Database, Plus, Link2, Copy, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

type EngineChoice = 'postgres' | 'mongodb' | 'mysql';

const roleLabels: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Админ',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

type ApiMemberRole = 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER';

function roleOptionsForRow(args: {
  myRole: string | undefined;
  targetRole: string;
  ownerCount: number;
  isSelf: boolean;
}): ApiMemberRole[] {
  const { myRole, targetRole, ownerCount, isSelf } = args;
  if (!myRole || (myRole !== 'owner' && myRole !== 'admin')) return [];
  if (myRole === 'admin') {
    if (targetRole === 'owner') return [];
    return ['VIEWER', 'EDITOR', 'ADMIN'];
  }
  if (isSelf && targetRole === 'owner' && ownerCount <= 1) {
    return ['OWNER'];
  }
  return ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'];
}

function canRemoveMember(args: {
  myRole: string | undefined;
  targetRole: string;
  ownerCount: number;
}): boolean {
  const { myRole, targetRole, ownerCount } = args;
  if (!myRole || (myRole !== 'owner' && myRole !== 'admin')) return false;
  if (targetRole === 'owner' && myRole !== 'owner') return false;
  if (targetRole === 'owner' && ownerCount <= 1) return false;
  return true;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = id!;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [allDatabases, setAllDatabases] = useState<Database[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [managedEngine, setManagedEngine] = useState<EngineChoice>('postgres');
  const [managedName, setManagedName] = useState('');
  const [managedInitialSql, setManagedInitialSql] = useState('');
  const [creating, setCreating] = useState(false);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachDbId, setAttachDbId] = useState('');
  const [attaching, setAttaching] = useState(false);

  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [addingMember, setAddingMember] = useState(false);
  const [roleBusyUserId, setRoleBusyUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const ownerCount = useMemo(() => members.filter((m) => m.role === 'owner').length, [members]);
  const myMembership = useMemo(() => members.find((m) => m.id === user?.id), [members, user?.id]);
  const canCreateManagedDb = projectRoleAtLeast(myMembership?.role, 'admin');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, dbs, mem] = await Promise.all([
        fetchProject(projectId),
        fetchDatabases(),
        fetchProjectMembers(projectId),
      ]);
      setProject(p ?? null);
      setAllDatabases(dbs);
      setMembers(mem);
    } catch (e: unknown) {
      toast({
        title: 'Не удалось загрузить проект',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectDbs = useMemo(() => allDatabases.filter((d) => d.projectId === projectId), [allDatabases, projectId]);

  const attachable = useMemo(
    () => allDatabases.filter((d) => d.projectId !== projectId),
    [allDatabases, projectId],
  );

  const handleCreateManaged = async () => {
    const name = managedName.trim();
    if (!name) {
      toast({ title: 'Введите имя базы', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const initialSql = managedEngine === 'mongodb' ? undefined : managedInitialSql.trim() || undefined;
      if (managedEngine === 'mongodb') {
        await createManagedMongoDatabase({ projectId, name });
      } else if (managedEngine === 'mysql') {
        await createManagedMysqlDatabase({ projectId, name, initialSql });
      } else {
        await createManagedPostgresDatabase({ projectId, name, initialSql });
      }
      toast({ title: 'База создаётся', description: 'Через несколько секунд она появится в списке.' });
      setCreateOpen(false);
      setManagedName('');
      setManagedInitialSql('');
      await load();
    } catch (e: unknown) {
      toast({
        title: 'Не удалось создать БД',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleAttach = async () => {
    if (!attachDbId) return;
    setAttaching(true);
    try {
      await moveDatabaseToProject(attachDbId, projectId);
      toast({ title: 'База перенесена в этот проект' });
      setAttachOpen(false);
      setAttachDbId('');
      await load();
    } catch (e: unknown) {
      toast({
        title: 'Не удалось перенести базу',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setAttaching(false);
    }
  };

  const handleCopyInvite = async () => {
    setInviteBusy(true);
    try {
      const { token } = await createProjectInvite(projectId);
      const url = `${window.location.origin}/join/${token}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Ссылка скопирована',
        description: 'Отправьте её участнику. Срок действия — 7 дней.',
      });
    } catch (e: unknown) {
      toast({
        title: 'Не удалось создать приглашение',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setInviteBusy(false);
    }
  };

  const handleAddByUsername = async () => {
    const u = inviteUsername.trim().toLowerCase();
    if (!u) {
      toast({ title: 'Введите username', variant: 'destructive' });
      return;
    }
    setAddingMember(true);
    try {
      await addProjectMemberByUsername(projectId, u, inviteRole);
      toast({ title: 'Приглашение отправлено', description: 'Пользователь увидит его в разделе «Уведомления».' });
      setInviteUsername('');
      await load();
    } catch (e: unknown) {
      toast({
        title: 'Не удалось добавить',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setAddingMember(false);
    }
  };

  const handleRoleChange = async (m: TeamMember, role: ApiMemberRole) => {
    if (m.role.toUpperCase() === role) return;
    setRoleBusyUserId(m.id);
    try {
      await updateProjectMemberRole(projectId, m.id, role);
      toast({ title: 'Роль обновлена' });
      await load();
    } catch (e: unknown) {
      toast({
        title: 'Не удалось изменить роль',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setRoleBusyUserId(null);
    }
  };

  const confirmRemoveMember = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await removeProjectMember(projectId, removeTarget.id);
      toast({ title: 'Участник исключён' });
      setRemoveTarget(null);
      await load();
    } catch (e: unknown) {
      toast({
        title: 'Не удалось исключить',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 rounded-2xl" /></div>;
  if (!project) return <div className="text-center py-20 text-muted-foreground">Проект не найден</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={() => navigate('/projects')} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{project.name}</h1>
            <p className="text-sm text-muted-foreground">{project.description || 'Без описания'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="hero" size="sm" className="rounded-xl" disabled={!canCreateManagedDb} onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Новая БД на платформе
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => navigate(`/databases?create=true&projectId=${projectId}`)}>
            <Link2 className="w-4 h-4" /> Подключить внешнюю БД
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setAttachOpen(true)} disabled={attachable.length === 0}>
            <Database className="w-4 h-4" /> Перенести свою БД
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span><span className="font-medium text-foreground">{projectDbs.length}</span> баз в проекте</span>
        <span>·</span>
        <span><span className="font-medium text-foreground">{members.length}</span> участников</span>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card p-5">
        <h2 className="font-semibold text-foreground mb-4">Базы данных</h2>
        <div className="space-y-2">
          {projectDbs.map((db) => (
            <button
              type="button"
              key={db.id}
              onClick={() => navigate(`/databases/${db.id}`)}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{db.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{db.engine} {db.version}</p>
                </div>
              </div>
              <StatusBadge status={db.status} />
            </button>
          ))}
          {projectDbs.length === 0 && <p className="text-sm text-muted-foreground">В этом проекте пока нет баз — создайте или перенесите из другого проекта.</p>}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" /> Участники
          </h2>
          <Button type="button" variant="outline" size="sm" className="rounded-xl gap-2" disabled={inviteBusy} onClick={() => void handleCopyInvite()}>
            <Copy className="w-4 h-4" /> Ссылка-приглашение
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Пригласить по username — человек получит уведомление и сможет принять приглашение здесь или по ссылке.
            Роли участников ниже может менять владелец и администратор (исключить единственного владельца нельзя).
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Username</Label>
              <Input
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="alex_dev"
                className="rounded-xl font-mono text-sm"
              />
            </div>
            <div className="w-full sm:w-40 space-y-1.5">
              <Label className="text-xs">Роль</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'EDITOR' | 'VIEWER')}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Наблюдатель</SelectItem>
                  <SelectItem value="EDITOR">Редактор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="hero" className="rounded-xl shrink-0" disabled={addingMember} onClick={() => void handleAddByUsername()}>
              <UserPlus className="w-4 h-4" /> Пригласить
            </Button>
          </div>
        </div>

        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {members.map((m) => {
            const isSelf = m.id === user?.id;
            const opts = roleOptionsForRow({
              myRole: myMembership?.role,
              targetRole: m.role,
              ownerCount,
              isSelf,
            });
            const showRemove = canRemoveMember({
              myRole: myMembership?.role,
              targetRole: m.role,
              ownerCount,
            });

            return (
              <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}{m.username ? ` · @${m.username}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {opts.length > 0 ? (
                    <Select
                      value={m.role.toUpperCase()}
                      disabled={roleBusyUserId === m.id}
                      onValueChange={(v) => void handleRoleChange(m, v as ApiMemberRole)}
                    >
                      <SelectTrigger className="rounded-xl w-[152px] h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {opts.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabels[r.toLowerCase()] ?? r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs rounded-full bg-secondary px-2 py-1">{roleLabels[m.role] ?? m.role}</span>
                  )}
                  {roleBusyUserId === m.id && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  {showRemove && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-xl h-9 w-9 text-destructive hover:text-destructive"
                      disabled={removeBusy}
                      onClick={() => setRemoveTarget(m)}
                      aria-label="Исключить из проекта"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && !removeBusy && setRemoveTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Исключить из проекта?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget ? (
                <>
                  Пользователь <span className="font-medium text-foreground">{removeTarget.name}</span> потеряет доступ к проекту и базам в нём.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={removeBusy}>Отмена</AlertDialogCancel>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={removeBusy}
              onClick={() => void confirmRemoveMember()}
            >
              {removeBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Исключить'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Новая управляемая БД</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>СУБД</Label>
              <Select
                value={managedEngine}
                onValueChange={(v) => {
                  const nv = v as EngineChoice;
                  setManagedEngine(nv);
                  if (nv === 'mongodb') setManagedInitialSql('');
                }}
              >
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="postgres">PostgreSQL</SelectItem>
                  <SelectItem value="mysql">MySQL</SelectItem>
                  <SelectItem value="mongodb">MongoDB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="managed-db-name">Имя базы</Label>
              <Input id="managed-db-name" value={managedName} onChange={(e) => setManagedName(e.target.value)} placeholder="main-api" className="rounded-xl" />
            </div>
            {managedEngine !== 'mongodb' ? (
              <div className="space-y-2">
                <Label htmlFor="managed-initial-sql">Начальный SQL (необязательно)</Label>
                <Textarea
                  id="managed-initial-sql"
                  value={managedInitialSql}
                  onChange={(e) => setManagedInitialSql(e.target.value)}
                  placeholder={managedEngine === 'mysql' ? '-- допускается несколько выражений через ;' : '-- DDL/данные после создания БД'}
                  className="rounded-xl font-mono text-xs min-h-[100px]"
                  spellCheck={false}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button variant="hero" className="rounded-xl" disabled={creating} onClick={() => void handleCreateManaged()}>
              {creating ? 'Создание…' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Перенести базу в этот проект</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Выберите базу из другого проекта, к которому у вас есть доступ. Карточка будет привязана к «{project.name}» (в старом проекте она пропадёт из списка).
          </p>
          <div className="space-y-2">
            <Label>База</Label>
            <Select value={attachDbId} onValueChange={setAttachDbId}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Выберите базу" /></SelectTrigger>
              <SelectContent>
                {attachable.map((db) => (
                  <SelectItem key={db.id} value={db.id}>
                    {db.name} ({db.engine})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setAttachOpen(false)}>Отмена</Button>
            <Button variant="hero" className="rounded-xl" disabled={!attachDbId || attaching} onClick={() => void handleAttach()}>
              {attaching ? 'Перенос…' : 'Перенести'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
