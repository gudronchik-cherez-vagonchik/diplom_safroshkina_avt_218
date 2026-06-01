import { Search, Plus, Bell, Command, UserRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { fetchNotifications, fetchUnreadNotificationCount } from '@/services/api';
import type { NotificationRecord } from '@/types';
import { cn } from '@/lib/utils';

interface TopbarProps {
  onOpenCommand?: () => void;
}

export default function Topbar({ onOpenCommand }: TopbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [preview, setPreview] = useState<NotificationRecord[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refreshUnread = useCallback(async () => {
    try {
      const n = await fetchUnreadNotificationCount();
      setUnreadCount(n);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const t = window.setInterval(() => void refreshUnread(), 45000);
    const onBump = () => void refreshUnread();
    window.addEventListener('dataisland:notifications', onBump);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('dataisland:notifications', onBump);
    };
  }, [refreshUnread]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const list = await fetchNotifications(12);
      setPreview(list);
    } catch {
      setPreview([]);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bellOpen) void loadPreview();
  }, [bellOpen, loadPreview]);

  const payloadStr = (p: Record<string, unknown>, key: string) => {
    const v = p[key];
    return typeof v === 'string' ? v : undefined;
  };

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 gap-4">
      <button
        onClick={onOpenCommand}
        className="hidden md:flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-muted-foreground text-sm w-full max-w-md hover:bg-secondary/80 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left">Поиск разделов, баз, проектов…</span>
        <kbd className="hidden lg:inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-background border border-border text-xs text-muted-foreground">
          <Command className="w-3 h-3" /> K
        </kbd>
      </button>

      <div className="md:hidden flex items-center">
        <span className="font-bold text-foreground text-lg tracking-tight">МояБД</span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="hero" size="sm" className="hidden sm:inline-flex" onClick={() => navigate('/databases')}>
          <Plus className="w-4 h-4" />
          <span className="hidden lg:inline">Создать</span>
        </Button>

        <DropdownMenu open={bellOpen} onOpenChange={setBellOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative w-10 h-10 rounded-xl flex items-center justify-center hover:bg-secondary transition-colors text-muted-foreground"
              aria-label="Уведомления"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground flex items-center justify-center tabular-nums">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(100vw-2rem,380px)] rounded-xl p-0 overflow-hidden">
            <DropdownMenuLabel className="px-3 py-2 text-sm font-semibold">Уведомления</DropdownMenuLabel>
            <DropdownMenuSeparator className="my-0" />
            <div className="max-h-[min(360px,50vh)] overflow-y-auto">
              {previewLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : preview.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-6 text-center">Пока нет событий</p>
              ) : (
                preview.map((n) => (
                  <DropdownMenuItem
                    key={n.id}
                    className={cn('flex flex-col items-start gap-0.5 px-3 py-2.5 cursor-pointer rounded-none', !n.read && 'bg-primary/[0.06]')}
                    onClick={() => {
                      setBellOpen(false);
                      navigate('/notifications');
                    }}
                  >
                    <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('ru-RU')}</span>
                    <span className="text-sm font-medium text-foreground line-clamp-2">{n.title}</span>
                    {n.body && <span className="text-xs text-muted-foreground line-clamp-2">{n.body}</span>}
                    {n.type === 'project_invite' && payloadStr(n.payload, 'inviteToken') && (
                      <span className="text-[11px] text-primary mt-1">Откройте раздел, чтобы принять</span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </div>
            <DropdownMenuSeparator className="my-0" />
            <DropdownMenuItem
              className="justify-center text-primary font-medium cursor-pointer py-2.5"
              onClick={() => {
                setBellOpen(false);
                navigate('/notifications');
              }}
            >
              Все уведомления
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-medium text-sm shadow-sm"
          >
            {user?.name?.charAt(0) || 'U'}
          </button>
          {showUserMenu && (
            <div className="absolute right-0 top-12 w-48 rounded-xl bg-card border border-border shadow-elevated p-1 z-50 animate-fade-in">
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <button
                onClick={() => {
                  navigate('/profile');
                  setShowUserMenu(false);
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <UserRound className="w-4 h-4 text-muted-foreground" />
                Профиль
              </button>
              <button onClick={() => { logout(); setShowUserMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-secondary rounded-lg transition-colors">
                Выйти
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
