import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { syncManagedDatabaseHealth } from '@/services/api';
import type { Database } from '@/types';

export default function ManagedHealthBanner({
  db,
  onSynced,
  allowHealthSync = true,
}: {
  db: Database;
  onSynced: () => Promise<void>;
  /** Если false (например роль «наблюдатель»), кнопка сброса статуса скрыта. */
  allowHealthSync?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleSync = async () => {
    setBusy(true);
    try {
      await syncManagedDatabaseHealth(db.id);
      toast({
        title: 'Статус обновлён',
        description: 'Если база на платформе в порядке, можно продолжать работу.',
      });
      await onSynced();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Подключение недоступно',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  if (db.region !== 'managed') return null;
  if (db.status !== 'error' && db.status !== 'migrating') return null;

  return (
    <div className="rounded-xl border border-destructive/35 bg-destructive/[0.07] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-sm text-muted-foreground leading-relaxed">
        {allowHealthSync ? (
          db.status === 'migrating'
            ? 'Операция с базой могла не завершиться. Если инстанс уже доступен, нажмите «Проверить подключение», чтобы снять зависший статус.'
            : 'Последняя операция завершилась с ошибкой или доступ временно пропал. Если база на платформе жива, проверьте подключение — мы обновим статус карточки.'
        ) : db.status === 'migrating' ? (
          'Операция с базой могла не завершиться. Попросите участника с ролью редактор или выше нажать «Проверить подключение» на карточке базы.'
        ) : (
          'Последняя операция завершилась с ошибкой или доступ временно пропал. Проверку подключения и сброс статуса может выполнить редактор или администратор проекта.'
        )}
      </p>
      {allowHealthSync ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 rounded-xl gap-2"
          disabled={busy}
          onClick={() => void handleSync()}
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          Проверить подключение
        </Button>
      ) : null}
    </div>
  );
}
