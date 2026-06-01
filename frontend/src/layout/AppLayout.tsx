import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileNav from './MobileNav';
import CommandPalette from '@/components/CommandPalette';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function AppLayout() {
  const { user, loading } = useAuth();
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen w-full max-w-[100vw] bg-background overflow-x-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <Topbar onOpenCommand={() => setCommandOpen(true)} />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-x-hidden overflow-y-auto min-w-0 max-w-full">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
