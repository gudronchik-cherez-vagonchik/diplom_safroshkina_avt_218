import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { acceptProjectInvite, previewProjectInvitePublic } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function JoinProject() {
  const { token } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [preview, setPreview] = useState<{ projectName: string; role: string; expiresAt: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    previewProjectInvitePublic(token)
      .then(setPreview)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await acceptProjectInvite(token);
      toast({
        title: res.alreadyMember ? 'Вы уже в проекте' : 'Вы присоединились к проекту',
      });
      navigate(`/projects/${res.projectId}`);
    } catch (e: unknown) {
      toast({
        title: 'Не удалось принять приглашение',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-card p-6 space-y-4">
        <h1 className="text-xl font-bold text-foreground">Приглашение в проект</h1>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !preview ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Вас пригласили в проект <span className="font-medium text-foreground">{preview.projectName}</span> с ролью{' '}
              <span className="font-mono text-xs">{preview.role}</span>. Ссылка действительна до{' '}
              {new Date(preview.expiresAt).toLocaleString('ru-RU')}.
            </p>
            {authLoading ? (
              <p className="text-sm text-muted-foreground">Проверка сессии…</p>
            ) : user ? (
              <Button variant="hero" className="w-full rounded-xl" disabled={accepting} onClick={() => void handleAccept()}>
                {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Вступить'}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Войдите или зарегистрируйтесь, чтобы принять приглашение.</p>
                <Button variant="hero" className="w-full rounded-xl" asChild>
                  <Link to={`/login?next=/join/${encodeURIComponent(token ?? '')}`}>Войти</Link>
                </Button>
                <Button variant="outline" className="w-full rounded-xl" asChild>
                  <Link to={`/signup?next=/join/${encodeURIComponent(token ?? '')}`}>Регистрация</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
