import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      const next = searchParams.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch {
      toast({ title: 'Ошибка входа', description: 'Проверьте введённые данные.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8">
            <span className="text-2xl font-bold text-foreground tracking-tight">МояБД</span>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-1">С возвращением</h1>
          <p className="text-muted-foreground mb-8">Войдите в аккаунт для продолжения</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1.5 rounded-xl h-11" required />
            </div>
            <div>
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="mt-1.5 rounded-xl h-11" required />
            </div>
            <Button type="submit" variant="hero" className="w-full h-11" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Войти'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Нет аккаунта?{' '}
            <Link
              to={searchParams.get('next') ? `/signup?next=${encodeURIComponent(searchParams.get('next')!)}` : '/signup'}
              className="text-primary font-medium hover:underline"
            >
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-primary relative overflow-hidden border-l border-border">
        <div className="relative z-10 text-center p-12">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4">Управляйте данными<br />без усилий.</h2>
          <p className="text-primary-foreground/80 max-w-sm mx-auto">Создавайте, подключайте и масштабируйте базы данных в облаке с единой мощной платформой.</p>
        </div>
        <div className="absolute top-20 right-20 w-64 h-64 rounded-full border border-primary-foreground/10" />
        <div className="absolute bottom-32 left-16 w-40 h-40 rounded-full border border-primary-foreground/10" />
        <div className="absolute top-1/2 right-1/3 w-20 h-20 rounded-2xl border border-primary-foreground/15 rotate-45" />
        <div className="absolute bottom-20 right-32 w-32 h-32 rounded-full bg-primary-foreground/5" />
        <div className="absolute top-32 left-32 w-16 h-16 rounded-xl bg-primary-foreground/5 rotate-12" />
      </div>
    </div>
  );
}
