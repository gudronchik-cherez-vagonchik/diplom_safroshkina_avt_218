import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  acceptProjectInvite,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/api';
import type { NotificationRecord } from '@/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, Check, CheckCheck, FolderKanban, Loader2, Mail, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function payloadStr(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

function typeBadge(type: string): { label: string; Icon: typeof Bell } {
  switch (type) {
    case 'project_invite':
      return { label: 'Приглашение', Icon: Mail };
    case 'project_created':
      return { label: 'Проект', Icon: FolderKanban };
    case 'project_removed':
    case 'project_role_changed':
      return { label: 'Проект', Icon: FolderKanban };
    case 'database_created':
    case 'database_connected':
    case 'database_moved':
      return { label: 'База данных', Icon: Database };
    default:
      return { label: 'Событие', Icon: Bell };
  }
}

export default function Notifications() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAll, setBusyAll] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchNotifications(80);
      setItems(list);
    } catch (e: unknown) {
      toast({
        title: 'Не удалось загрузить уведомления',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const bumpGlobal = () => window.dispatchEvent(new Event('dataisland:notifications'));

  const handleMarkRead = async (n: NotificationRecord, navigateTo?: string) => {
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        bumpGlobal();
      } catch {
        /* ignore */
      }
    }
    if (navigateTo) navigate(navigateTo);
  };

  const handleOpenRow = (n: NotificationRecord) => {
    const p = n.payload;
    const dbId = payloadStr(p, 'databaseId');
    const projId = payloadStr(p, 'projectId');

    if (n.type.startsWith('database_') && dbId) {
      void handleMarkRead(n, `/databases/${dbId}`);
      return;
    }
    if (n.type === 'project_created' && projId) {
      void handleMarkRead(n, `/projects/${projId}`);
      return;
    }
    if ((n.type === 'project_role_changed') && projId) {
      void handleMarkRead(n, `/projects/${projId}`);
      return;
    }
    if (n.type === 'project_removed') {
      void handleMarkRead(n, '/projects');
      return;
    }
    if (!n.read) void handleMarkRead(n);
  };

  const handleAcceptInvite = async (n: NotificationRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    const token = payloadStr(n.payload, 'inviteToken');
    if (!token) return;
    setAcceptingId(n.id);
    try {
      const res = await acceptProjectInvite(token);
      toast({
        title: res.alreadyMember ? 'Вы уже в проекте' : 'Вы вступили в проект',
      });
      setItems((prev) =>
        prev.map((x) => (x.type === 'project_invite' && payloadStr(x.payload, 'inviteToken') === token ? { ...x, read: true } : x)),
      );
      bumpGlobal();
      navigate(`/projects/${res.projectId}`);
    } catch (err: unknown) {
      toast({
        title: 'Не удалось принять приглашение',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleMarkAll = async () => {
    setBusyAll(true);
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      bumpGlobal();
      toast({ title: 'Все отмечены прочитанными' });
    } catch (e: unknown) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setBusyAll(false);
    }
  };

  const unread = items.filter((x) => !x.read).length;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-7 h-7 text-primary" />
            Уведомления
          </h1>
          <p className="text-muted-foreground mt-1">
            {unread > 0 ? `${unread} непрочитанных` : 'Нет непрочитанных'}
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl shrink-0"
          disabled={busyAll || unread === 0}
          onClick={() => void handleMarkAll()}
        >
          {busyAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4 mr-2" />}
          Прочитать все
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16 px-4">Пока пусто — здесь появятся приглашения, проекты и базы.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const { label, Icon } = typeBadge(n.type);
              const isInvite = n.type === 'project_invite' && payloadStr(n.payload, 'inviteToken');
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenRow(n)}
                    className={cn(
                      'w-full text-left p-4 flex gap-3 transition-colors hover:bg-secondary/40',
                      !n.read && 'bg-primary/[0.06]',
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-muted/80 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-primary">{label}</span>
                        {!n.read && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Новое</span>}
                      </div>
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground leading-relaxed">{n.body}</p>}
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {new Date(n.createdAt).toLocaleString('ru-RU')}
                      </p>
                      {isInvite && (
                        <div className="flex flex-wrap gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="hero"
                            className="rounded-xl h-8"
                            disabled={acceptingId === n.id}
                            onClick={(e) => void handleAcceptInvite(n, e)}
                          >
                            {acceptingId === n.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Принять'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl h-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMarkRead(n);
                            }}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Скрыть
                          </Button>
                        </div>
                      )}
                      {!isInvite && !n.read && (
                        <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl h-8 text-muted-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMarkRead(n);
                            }}
                          >
                            Отметить прочитанным
                          </Button>
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
