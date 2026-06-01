import { cn } from '@/lib/utils';
import type { DbStatus } from '@/types';

const statusStyles: Record<DbStatus, string> = {
  running: 'bg-success/10 text-success',
  stopped: 'bg-muted text-muted-foreground',
  migrating: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
  provisioning: 'bg-primary/10 text-primary',
};

const dotStyles: Record<DbStatus, string> = {
  running: 'bg-success',
  stopped: 'bg-muted-foreground',
  migrating: 'bg-warning',
  error: 'bg-destructive',
  provisioning: 'bg-primary animate-pulse-soft',
};

const statusLabels: Record<DbStatus, string> = {
  running: 'Работает',
  stopped: 'Отключена',
  migrating: 'Миграция',
  error: 'Ошибка',
  provisioning: 'Создание',
};

export default function StatusBadge({ status }: { status: DbStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", statusStyles[status])}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dotStyles[status])} />
      {statusLabels[status]}
    </span>
  );
}
