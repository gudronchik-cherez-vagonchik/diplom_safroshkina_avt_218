import { useEffect, useState } from 'react';
import { fetchPlans } from '@/services/api';
import type { Plan } from '@/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Billing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    void fetchPlans().then((p) => {
      setPlans(p);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Биллинг</h1>
        <p className="text-muted-foreground mt-1">Управление подпиской</p>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => (
              <div
                key={p.id}
                className={`rounded-2xl border p-5 transition-all duration-300 ${
                  p.current ? 'border-primary shadow-card-hover bg-primary/5' : 'border-border bg-card shadow-card hover:shadow-card-hover'
                }`}
              >
                {p.current && (
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary text-primary-foreground mb-3">Текущий</span>
                )}
                <h3 className="text-lg font-bold text-foreground">{p.name}</h3>
                <div className="mt-2 mb-4">
                  <span className="text-3xl font-bold text-foreground">${p.price}</span>
                  <span className="text-muted-foreground text-sm">/мес</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={p.current ? 'outline' : 'hero'}
                  className="w-full"
                  size="sm"
                  onClick={() => !p.current && toast({ title: 'Тариф обновлён' })}
                >
                  {p.current ? 'Текущий тариф' : 'Выбрать'}
                </Button>
              </div>
            ))}
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-card p-5">
            <h2 className="font-semibold text-foreground mb-4">Текущее использование</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: 'Базы данных', used: 7, total: '∞', pct: 10 },
                { label: 'Хранилище', used: '97 ГБ', total: '500 ГБ', pct: 19 },
                { label: 'Участники', used: 4, total: 20, pct: 20 },
              ].map((u) => (
                <div key={u.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{u.label}</span>
                    <span className="font-medium text-foreground">
                      {u.used} / {u.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-primary/85" style={{ width: `${u.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
