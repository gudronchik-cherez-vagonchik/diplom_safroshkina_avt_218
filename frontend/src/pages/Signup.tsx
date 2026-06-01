import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signup(name, email, password);
      const next = searchParams.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch {
      toast({ title: 'Ошибка регистрации', description: 'Попробуйте ещё раз.', variant: 'destructive' });
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

          <h1 className="text-2xl font-bold text-foreground mb-1">Создайте аккаунт</h1>
          <p className="text-muted-foreground mb-8">Начните работу с МояБД бесплатно</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Полное имя</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Алексей Иванов" className="mt-1.5 rounded-xl h-11" required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1.5 rounded-xl h-11" required />
            </div>
            <div>
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Минимум 8 символов" className="mt-1.5 rounded-xl h-11" required />
            </div>
            <Button type="submit" variant="hero" className="w-full h-11" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать аккаунт'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">Войти</Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-primary relative overflow-hidden border-l border-border">
        <div className="relative z-10 text-center p-12">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4">Ваши базы данных,<br />одна платформа.</h2>
          <p className="text-primary-foreground/80 max-w-sm mx-auto">PostgreSQL, MySQL, MariaDB, MongoDB — управляйте всем в одном месте.</p>
        </div>
        <div className="absolute top-16 left-20 w-48 h-48 rounded-full border border-primary-foreground/10" />
        <div className="absolute bottom-24 right-24 w-72 h-72 rounded-full border border-primary-foreground/10" />
        <div className="absolute top-1/3 right-20 w-24 h-24 rounded-2xl bg-primary-foreground/5 rotate-12" />
      </div>
    </div>
  );
}
