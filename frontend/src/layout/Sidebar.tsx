import { Link, useLocation } from 'react-router-dom';
import { Database, FolderKanban, LayoutDashboard, Users, ChevronLeft, ChevronRight, UserRound, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const navItems = [
  { label: 'Дашборд', icon: LayoutDashboard, path: '/' },
  { label: 'Проекты', icon: FolderKanban, path: '/projects' },
  { label: 'Базы данных', icon: Database, path: '/databases' },
  { label: 'Уведомления', icon: Bell, path: '/notifications' },
  { label: 'Профиль', icon: UserRound, path: '/profile' },
  { label: 'Команда', icon: Users, path: '/team' },
];

export default function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={cn(
      "hidden md:flex flex-col border-r border-border bg-card transition-all duration-300 relative",
      collapsed ? "w-[68px]" : "w-[240px]"
    )}>
      <div
        className={cn(
          'h-16 flex items-center px-4 border-b border-border',
          collapsed ? 'justify-center' : '',
        )}
      >
        <span
          className={cn(
            'font-bold tracking-tight text-foreground',
            collapsed ? 'text-[11px] leading-none' : 'text-lg',
          )}
        >
          {collapsed ? 'МБ' : 'МояБД'}
        </span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map(item => {
          const active = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    </aside>
  );
}
