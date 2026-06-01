import { Link, useLocation } from 'react-router-dom';
import { Database, FolderKanban, LayoutDashboard, Users, UserRound, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { label: 'Главная', icon: LayoutDashboard, path: '/' },
  { label: 'Проекты', icon: FolderKanban, path: '/projects' },
  { label: 'БД', icon: Database, path: '/databases' },
  { label: 'Увед', icon: Bell, path: '/notifications' },
  { label: 'Профиль', icon: UserRound, path: '/profile' },
  { label: 'Команда', icon: Users, path: '/team' },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border glass">
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map(tab => {
          const active = location.pathname === tab.path || (tab.path !== '/' && location.pathname.startsWith(tab.path));
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-colors min-w-[56px]",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
