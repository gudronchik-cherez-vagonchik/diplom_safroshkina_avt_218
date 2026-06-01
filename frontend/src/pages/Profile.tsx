import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { updateProfile } from '@/services/api';

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setUsername(user.username ?? '');
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextUsername = username.trim();
      await updateProfile({
        name: name.trim(),
        username: nextUsername === '' ? null : nextUsername,
      });
      await refreshUser();
      toast({ title: 'Профиль сохранён' });
    } catch (e: unknown) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Профиль</h1>
        <p className="text-muted-foreground mt-1">
          Имя и username. По username вас можно добавить в проект. Email меняется только через поддержку.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" readOnly value={user.email} className="rounded-xl bg-muted/40" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Имя</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="например: alex_dev"
            className="rounded-xl font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">3–30 символов: латиница, цифры, подчёркивание. Оставьте пустым, чтобы сбросить.</p>
        </div>
        <Button variant="hero" className="rounded-xl" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}
