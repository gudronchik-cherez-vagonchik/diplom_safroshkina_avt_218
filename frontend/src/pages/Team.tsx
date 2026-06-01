import { useEffect, useState } from 'react';
import { fetchTeamMembers } from '@/services/api';
import type { TeamMember } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

const roleLabels: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Админ',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeamMembers().then(d => { setMembers(d); setLoading(false); });
  }, []);

  const roleColors: Record<string, string> = {
    owner: 'bg-primary/10 text-primary',
    admin: 'bg-accent/10 text-accent',
    editor: 'bg-warning/10 text-warning',
    viewer: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Команда</h1>
          <p className="text-muted-foreground mt-1">{members.length} участников</p>
        </div>
        <span className="text-xs text-muted-foreground">
          Сводный список участников. Управление ролями и исключение — в карточке каждого проекта (права у владельца и администратора проекта).
        </span>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : (
          <div className="divide-y divide-border">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-medium text-sm shadow-sm">
                    {m.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[m.role]}`}>{roleLabels[m.role]}</span>
                  <p className="text-xs text-muted-foreground hidden sm:block">Присоединился {new Date(m.joinedAt).toLocaleDateString('ru-RU')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
