import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Download, Eye, EyeOff, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import ManagedHealthBanner from '@/components/ManagedHealthBanner';
import { useToast } from '@/hooks/use-toast';
import {
  createBackup,
  createMongoCollection,
  deleteBackup,
  deleteDatabase,
  deleteMongoCollection,
  deleteTableRow,
  downloadBackup,
  fetchBackups,
  fetchDatabaseConnectionInfo,
  fetchMongoVisual,
  fetchSchema,
  fetchTableData,
  insertTableRow,
  restoreBackup,
  type MongoVisualCollection,
  type MongoVisualField,
} from '@/services/api';
import type { Backup, Database, DatabaseConnectionInfo } from '@/types';
import { projectRoleAtLeast } from '@/types';

type MongoTab = 'overview' | 'collections' | 'documents' | 'structure' | 'indexes' | 'validation' | 'backups';

type SchemaCollection = { name: string; rows: number; size: string };

function FieldTree({ fields, depth = 0 }: { fields: MongoVisualField[]; depth?: number }) {
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div key={`${depth}-${field.name}`} style={{ marginLeft: depth * 16 }} className="rounded-xl border border-border/60 p-3 bg-background/50">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{field.name}</span>
            <span className="text-xs rounded-md bg-secondary px-2 py-1 text-muted-foreground">{field.types.join(' | ')}</span>
            <span className="text-xs text-muted-foreground">обязательное поле: {field.required ? 'да' : 'нет'}</span>
            <span className="text-xs text-muted-foreground">встречается в документах: ~{Math.round(field.frequency * 100)}%</span>
          </div>
          {field.children?.length ? <div className="mt-3"><FieldTree fields={field.children} depth={depth + 1} /></div> : null}
        </div>
      ))}
    </div>
  );
}

function BackupsSection({
  dbId,
  dbName,
  canEdit,
  canAdmin,
}: {
  dbId: string;
  dbName: string;
  canEdit: boolean;
  canAdmin: boolean;
}) {
  const { toast } = useToast();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyBackupId, setBusyBackupId] = useState<string | null>(null);
  const [backupDeleteId, setBackupDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setBackups(await fetchBackups(dbId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dbId]);

  const handleCreate = async () => {
    try {
      await createBackup(dbId);
      toast({ title: 'Бэкап создан' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось создать бэкап', description: error.message, variant: 'destructive' });
    }
  };

  const handleRestore = async (backupId: string) => {
    try {
      setBusyBackupId(backupId);
      await restoreBackup(dbId, backupId);
      toast({ title: 'Бэкап восстановлен' });
    } catch (error: any) {
      toast({ title: 'Не удалось восстановить бэкап', description: error.message, variant: 'destructive' });
    } finally {
      setBusyBackupId(null);
    }
  };

  const handleDownload = async (backup: Backup) => {
    try {
      setBusyBackupId(backup.id);
      await downloadBackup(dbId, backup.id, `${dbName}-${backup.createdAt.slice(0, 10)}.json`);
      toast({ title: 'Бэкап скачан' });
    } catch (error: any) {
      toast({ title: 'Не удалось скачать бэкап', description: error.message, variant: 'destructive' });
    } finally {
      setBusyBackupId(null);
    }
  };

  const runDeleteBackup = async (backupId: string) => {
    try {
      setBusyBackupId(backupId);
      await deleteBackup(dbId, backupId);
      toast({ title: 'Бэкап удалён' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось удалить бэкап', description: error.message, variant: 'destructive' });
    } finally {
      setBusyBackupId(null);
      setBackupDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <ConfirmModal
        open={backupDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setBackupDeleteId(null);
        }}
        title="Удалить этот бэкап?"
        description="Файл снимка будет удалён из МояБД без возможности восстановления."
        confirmLabel="Удалить"
        destructive
        confirmDisabled={busyBackupId !== null}
        onConfirm={() => backupDeleteId && void runDeleteBackup(backupDeleteId)}
      />
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">Бэкапы</h3>
          <p className="text-xs text-muted-foreground">Snapshot бэкапы MongoDB доступны для скачивания и восстановления.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Обновить</Button>
          {canEdit ? (
            <Button variant="hero" size="sm" onClick={handleCreate}><Plus className="w-4 h-4" /> Создать бэкап</Button>
          ) : null}
        </div>
      </div>
      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/30">
            <tr>
              <th className="text-left py-3 px-4">Дата</th>
              <th className="text-left py-3 px-4">Размер</th>
              <th className="text-left py-3 px-4">Тип</th>
              <th className="text-left py-3 px-4">Статус</th>
              <th className="text-left py-3 px-4">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => <tr key={idx}><td colSpan={5} className="py-3 px-4"><Skeleton className="h-6 w-full" /></td></tr>)
            ) : backups.length === 0 ? (
              <tr><td colSpan={5} className="py-8 px-4 text-center text-muted-foreground">Бэкапов пока нет</td></tr>
            ) : backups.map((backup) => (
              <tr key={backup.id} className="border-b border-border/50">
                <td className="py-3 px-4">{new Date(backup.createdAt).toLocaleString()}</td>
                <td className="py-3 px-4">{backup.size}</td>
                <td className="py-3 px-4">{backup.type}</td>
                <td className="py-3 px-4"><StatusBadge status={backup.status === 'completed' ? 'running' : backup.status === 'failed' ? 'error' : 'provisioning'} /></td>
                <td className="py-3 px-4">
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" disabled={busyBackupId === backup.id} onClick={() => void handleDownload(backup)}><Download className="w-4 h-4" /> JSON</Button>
                    {canAdmin ? (
                      <Button variant="outline" size="sm" disabled={busyBackupId === backup.id} onClick={() => void handleRestore(backup.id)}><RotateCcw className="w-4 h-4" /> Восстановить</Button>
                    ) : null}
                    {canEdit ? (
                    <Button variant="outline" size="sm" className="text-destructive border-destructive/40" disabled={busyBackupId === backup.id} onClick={() => setBackupDeleteId(backup.id)}><Trash2 className="w-4 h-4" /></Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MongoDatabaseDetail({ db, reloadDb }: { db: Database; reloadDb: () => Promise<void> }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<MongoTab>('overview');
  const [connectionInfo, setConnectionInfo] = useState<DatabaseConnectionInfo | null>(null);
  const [showConn, setShowConn] = useState(false);
  const [showMongoPassword, setShowMongoPassword] = useState(false);
  const [schema, setSchema] = useState<SchemaCollection[]>([]);
  const [visual, setVisual] = useState<{ collections: MongoVisualCollection[]; references: any[] } | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [documents, setDocuments] = useState<Record<string, any>[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [newDocumentJson, setNewDocumentJson] = useState('{\n  \n}');
  const [deleteDbConfirmOpen, setDeleteDbConfirmOpen] = useState(false);
  const [deletingDb, setDeletingDb] = useState(false);

  const canEdit = projectRoleAtLeast(db.myProjectRole, 'editor');
  const canAdmin = projectRoleAtLeast(db.myProjectRole, 'admin');

  const tabs: { key: MongoTab; label: string }[] = [
    { key: 'overview', label: 'Обзор' },
    { key: 'collections', label: 'Коллекции' },
    { key: 'documents', label: 'Документы' },
    { key: 'structure', label: 'Структура' },
    { key: 'indexes', label: 'Индексы' },
    { key: 'validation', label: 'Валидация' },
    { key: 'backups', label: 'Бэкапы' },
  ];

  const load = async () => {
    setLoading(true);
    try {
      const [nextSchema, nextVisual] = await Promise.all([fetchSchema(db.id), fetchMongoVisual(db.id)]);
      setSchema(nextSchema as any);
      setVisual(nextVisual);
      if (!selectedCollection) {
        setSelectedCollection((nextSchema as any)[0]?.name ?? '');
      }
    } catch (error: any) {
      toast({ title: 'Не удалось загрузить MongoDB', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [db.id]);

  useEffect(() => {
    if (!selectedCollection) return;
    setDocumentsLoading(true);
    fetchTableData(db.id, selectedCollection, 50, 0)
      .then((result) => setDocuments(result.rows))
      .catch((error: any) => toast({ title: 'Не удалось загрузить документы', description: error.message, variant: 'destructive' }))
      .finally(() => setDocumentsLoading(false));
  }, [db.id, selectedCollection]);

  const totalDocuments = useMemo(() => schema.reduce((sum, collection) => sum + Number(collection.rows || 0), 0), [schema]);
  const totalCollections = schema.length;

  const ensureConnectionInfo = async () => {
    if (connectionInfo) return connectionInfo;
    const info = await fetchDatabaseConnectionInfo(db.id);
    setConnectionInfo(info);
    return info;
  };

  const handleCopyConnection = async () => {
    try {
      const info = await ensureConnectionInfo();
      await navigator.clipboard.writeText(info.connectionString);
      toast({ title: 'Строка подключения скопирована' });
    } catch (error: any) {
      toast({ title: 'Не удалось скопировать строку подключения', description: error.message, variant: 'destructive' });
    }
  };

  const toggleConnection = async () => {
    if (showConn) {
      setShowConn(false);
      setShowMongoPassword(false);
      return;
    }
    try {
      await ensureConnectionInfo();
      setShowConn(true);
    } catch (error: any) {
      toast({ title: 'Не удалось получить доступы', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateCollection = async () => {
    try {
      await createMongoCollection(db.id, newCollectionName);
      setNewCollectionName('');
      setCreateCollectionOpen(false);
      toast({ title: 'Коллекция создана' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось создать коллекцию', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteCollection = async (name: string) => {
    try {
      await deleteMongoCollection(db.id, name);
      if (selectedCollection === name) setSelectedCollection('');
      toast({ title: 'Коллекция удалена' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось удалить коллекцию', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateDocument = async () => {
    try {
      const payload = JSON.parse(newDocumentJson || '{}');
      await insertTableRow(db.id, selectedCollection, payload);
      setNewDocumentOpen(false);
      setNewDocumentJson('{\n  \n}');
      toast({ title: 'Документ добавлен' });
      const result = await fetchTableData(db.id, selectedCollection, 50, 0);
      setDocuments(result.rows);
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось добавить документ', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteTableRow(db.id, selectedCollection, '_id', id);
      toast({ title: 'Документ удалён' });
      const result = await fetchTableData(db.id, selectedCollection, 50, 0);
      setDocuments(result.rows);
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось удалить документ', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteDatabase = async () => {
    setDeletingDb(true);
    try {
      await deleteDatabase(db.id);
      toast({ title: db.region === 'managed' ? 'База удалена с платформы' : 'Подключение удалено' });
      navigate('/databases');
    } catch (error: any) {
      toast({ title: 'Не удалось удалить', description: error.message, variant: 'destructive' });
    } finally {
      setDeletingDb(false);
      setDeleteDbConfirmOpen(false);
    }
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-2xl" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <ManagedHealthBanner db={db} onSynced={reloadDb} allowHealthSync={canEdit} />

      <ConfirmModal
        open={deleteDbConfirmOpen}
        onOpenChange={setDeleteDbConfirmOpen}
        title="Удалить базу из проекта?"
        description={
          db.region === 'managed'
            ? 'Это управляемая база МояБД: будет удалён инстанс MongoDB на платформе вместе с данными и записями бэкапов в приложении. Действие необратимо.'
            : 'Это внешнее подключение: из проекта удалится только карточка и бэкапы в МояБД. Кластер MongoDB у вас не изменится.'
        }
        confirmLabel={db.region === 'managed' ? 'Удалить базу полностью' : 'Удалить подключение'}
        destructive
        confirmDisabled={deletingDb}
        onConfirm={() => void handleDeleteDatabase()}
      />

      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={() => navigate('/databases')} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{db.name}</h1>
              <StatusBadge status={db.status} />
              {db.region === 'external' && (
                <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">Внешнее подключение</span>
              )}
              {db.region === 'managed' && (
                <span className="text-xs rounded-full bg-primary/15 px-2 py-0.5 text-primary">Управляемая</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{db.engine} {db.version} · {db.storage}</p>
          </div>
        </div>
        {canAdmin ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0"
          onClick={() => setDeleteDbConfirmOpen(true)}
        >
          <Trash2 className="w-4 h-4" /> Удалить базу
        </Button>
        ) : null}
      </div>

      <div className="border-b border-border overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid xl:grid-cols-[1.3fr_1fr] gap-4">
          <div className="bg-card rounded-2xl border border-border shadow-card p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Обзор MongoDB</h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="rounded-xl bg-secondary/30 p-4"><p className="text-muted-foreground">Коллекции</p><p className="mt-2 text-2xl font-semibold">{totalCollections}</p></div>
              <div className="rounded-xl bg-secondary/30 p-4"><p className="text-muted-foreground">Документы</p><p className="mt-2 text-2xl font-semibold">{totalDocuments}</p></div>
              <div className="rounded-xl bg-secondary/30 p-4"><p className="text-muted-foreground">Предполагаемые связи</p><p className="mt-2 text-2xl font-semibold">{visual?.references.length ?? 0}</p></div>
            </div>
            <div className="rounded-2xl border border-border bg-secondary/20 p-4 space-y-3">
              <div className="flex gap-2 flex-wrap">
                {canEdit ? (
                  <>
                    <Button variant="outline" size="sm" onClick={toggleConnection}>{showConn ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showConn ? 'Скрыть доступы' : 'Показать доступы'}</Button>
                    <Button variant="outline" size="sm" onClick={handleCopyConnection}><Copy className="w-4 h-4" /> Скопировать строку подключения</Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Полные доступы видят редакторы и выше.</p>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Строка подключения:</span><div className="mt-1 rounded-xl bg-background px-3 py-2 font-mono text-xs break-all">{showConn && connectionInfo ? connectionInfo.connectionString : db.connectionString}</div></div>
                {showConn && connectionInfo ? (
                  <div className="grid md:grid-cols-2 gap-3">
                    <div><Label>Хост</Label><Input readOnly value={connectionInfo.host} className="mt-1.5 rounded-xl font-mono text-sm bg-background" /></div>
                    <div><Label>Порт</Label><Input readOnly value={String(connectionInfo.port)} className="mt-1.5 rounded-xl font-mono text-sm bg-background" /></div>
                    <div><Label>Имя БД</Label><Input readOnly value={connectionInfo.database} className="mt-1.5 rounded-xl font-mono text-sm bg-background" /></div>
                    <div><Label>SSL</Label><Input readOnly value={connectionInfo.ssl ? 'Да' : 'Нет'} className="mt-1.5 rounded-xl font-mono text-sm bg-background" /></div>
                    <div><Label>Пользователь</Label><Input readOnly value={connectionInfo.user} className="mt-1.5 rounded-xl font-mono text-sm bg-background" /></div>
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Пароль</Label>
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setShowMongoPassword((v) => !v)}>
                            {showMongoPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg"
                            onClick={() => {
                              void navigator.clipboard.writeText(connectionInfo.password);
                              toast({ title: 'Пароль скопирован' });
                            }}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <Input
                        readOnly
                        type={showMongoPassword ? 'text' : 'password'}
                        value={connectionInfo.password}
                        className="mt-1.5 rounded-xl font-mono text-sm bg-background"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-card p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Reference graph</h3>
            <div className="space-y-3">
              {(visual?.references.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Пока не найдено очевидных ссылок между коллекциями.</p>
              ) : visual!.references.map((reference) => (
                <div key={`${reference.fromCollection}-${reference.field}-${reference.toCollection}`} className="rounded-xl border border-border/60 p-3 text-sm bg-secondary/20">
                  <span className="font-medium">{reference.fromCollection}</span>
                  <span className="text-muted-foreground">.{reference.field} → </span>
                  <span className="font-medium">{reference.toCollection}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'collections' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-semibold text-foreground">Collections</h3>
              <p className="text-sm text-muted-foreground">Управляй коллекциями и быстро переходи к документам.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Обновить</Button>
              <Button variant="hero" size="sm" onClick={() => setCreateCollectionOpen(true)} disabled={!canEdit}><Plus className="w-4 h-4" /> Новая коллекция</Button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {schema.map((collection) => (
              <div key={collection.name} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <div className="flex justify-between gap-3 items-start">
                  <div>
                    <h4 className="font-semibold text-foreground">{collection.name}</h4>
                    <p className="text-xs text-muted-foreground">{collection.rows} docs · {collection.size}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={!canAdmin} onClick={() => handleDeleteCollection(collection.name)}><Trash2 className="w-4 h-4" /></Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setSelectedCollection(collection.name); setActiveTab('documents'); }}>Документы</Button>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedCollection(collection.name); setActiveTab('structure'); }}>Структура</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-3 items-center">
              <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)} className="h-10 px-3 rounded-xl border border-border bg-card text-sm text-foreground min-w-[240px]">
                {schema.map((collection) => <option key={collection.name} value={collection.name}>{collection.name}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={() => setNewDocumentOpen(true)} disabled={!selectedCollection || !canEdit}><Plus className="w-4 h-4" /> Документ</Button>
            </div>
            <Button variant="outline" size="sm" onClick={async () => {
              if (!selectedCollection) return;
              const result = await fetchTableData(db.id, selectedCollection, 50, 0);
              setDocuments(result.rows);
            }}><RefreshCw className="w-4 h-4" /> Обновить</Button>
          </div>
          <div className="space-y-3">
            {documentsLoading ? Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-24 rounded-2xl" />) : documents.length === 0 ? (
              <div className="rounded-2xl border border-border p-8 text-center text-muted-foreground bg-card">Документов пока нет</div>
            ) : documents.map((doc) => (
              <div key={String(doc._id)} className="rounded-2xl border border-border bg-card p-4 shadow-card space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">_id</p>
                    <p className="font-mono text-xs break-all">{String(doc._id)}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => handleDeleteDocument(String(doc._id))}><Trash2 className="w-4 h-4" /> Удалить</Button>
                </div>
                <pre className="rounded-xl bg-secondary/30 p-4 text-xs overflow-auto">{JSON.stringify(doc, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'structure' && (
        <div className="space-y-4">
          {(visual?.collections ?? []).map((collection) => (
            <div key={collection.name} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-semibold text-foreground">{collection.name}</h3>
                  <p className="text-sm text-muted-foreground">{collection.documents} docs · {(collection.sizeBytes / 1024).toFixed(1)} KB</p>
                </div>
                <div className="text-xs text-muted-foreground">indexes: {collection.indexes.length}</div>
              </div>
              <FieldTree fields={collection.fields} />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'indexes' && (
        <div className="space-y-4">
          {(visual?.collections ?? []).map((collection) => (
            <div key={collection.name} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h3 className="font-semibold text-foreground">{collection.name}</h3>
              {collection.indexes.length === 0 ? <p className="text-sm text-muted-foreground">Индексов нет</p> : collection.indexes.map((index) => (
                <div key={index.name} className="rounded-xl border border-border/60 p-3 bg-secondary/20 text-sm space-y-2">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-medium text-foreground">{index.name}</span>
                    {index.unique ? <span className="text-xs rounded-md bg-primary/10 px-2 py-1 text-primary">unique</span> : null}
                    {index.sparse ? <span className="text-xs rounded-md bg-secondary px-2 py-1 text-muted-foreground">sparse</span> : null}
                    {index.expireAfterSeconds !== null ? <span className="text-xs rounded-md bg-secondary px-2 py-1 text-muted-foreground">ttl {index.expireAfterSeconds}s</span> : null}
                  </div>
                  <pre className="text-xs overflow-auto">{JSON.stringify(index.key, null, 2)}</pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'validation' && (
        <div className="space-y-4">
          {(visual?.collections ?? []).map((collection) => (
            <div key={collection.name} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h3 className="font-semibold text-foreground">{collection.name}</h3>
              {collection.validation ? (
                <pre className="rounded-xl bg-secondary/30 p-4 text-xs overflow-auto">{JSON.stringify(collection.validation, null, 2)}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">Validation rules не настроены.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'backups' && <BackupsSection dbId={db.id} dbName={db.name} canEdit={canEdit} canAdmin={canAdmin} />}

      <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Новая коллекция</DialogTitle></DialogHeader>
          <div>
            <Label>Название</Label>
            <Input value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} className="mt-1.5 rounded-xl" placeholder="например users" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollectionOpen(false)}>Отмена</Button>
            <Button variant="hero" onClick={handleCreateCollection}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newDocumentOpen} onOpenChange={setNewDocumentOpen}>
        <DialogContent className="rounded-2xl max-w-2xl">
          <DialogHeader><DialogTitle>Новый документ</DialogTitle></DialogHeader>
          <div>
            <Label>JSON</Label>
            <textarea value={newDocumentJson} onChange={(e) => setNewDocumentJson(e.target.value)} className="w-full min-h-[280px] mt-1.5 rounded-2xl border border-border bg-card p-4 font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDocumentOpen(false)}>Отмена</Button>
            <Button variant="hero" onClick={handleCreateDocument}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
