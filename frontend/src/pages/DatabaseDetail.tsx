import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Copy, Download, Eye, EyeOff, FileCode, GitBranch, ImageDown, Play, Plus, RefreshCw, RotateCcw, Save, Trash2, GripVertical, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import StatusBadge from '@/components/StatusBadge';
import ManagedHealthBanner from '@/components/ManagedHealthBanner';
import ConfirmModal from '@/components/ConfirmModal';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  applyConstructor,
  applyMigration,
  createBackup,
  deleteBackup,
  deleteDatabase,
  deleteTableRow,
  downloadBackup,
  downloadBackupSql,
  fetchBackups,
  fetchConstructor,
  fetchDatabase,
  fetchDatabaseConnectionInfo,
  fetchMigrations,
  fetchSchema,
  fetchTableData,
  insertTableRow,
  migrateManagedSqlEngine,
  restoreBackup,
  runQuery,
  saveConstructorLayout,
  truncateDatabaseTable,
  updateTableRow,
  type ConstructorSchema,
} from '@/services/api';
import type { Backup, Database, DatabaseConnectionInfo, DbEngine, MigrationJob } from '@/types';
import { projectRoleAtLeast } from '@/types';
import {
  buildWizardMigrationSql,
  detectSqlDialect,
  WIZARD_SQL_TYPES_MYSQL,
  WIZARD_SQL_TYPES_POSTGRES,
  type WizardMigrationOp,
  type WizardMigrationOpKind,
} from '@/lib/migrationSql';
import MongoDatabaseDetail from './MongoDatabaseDetail';

type Tab = 'overview' | 'schema' | 'constructor' | 'data' | 'sql' | 'migrations' | 'backups';

type SchemaTable = { name: string; columns: number; rows: number; size: string };


type VisualColumn = {
  id: string;
  name: string;
  type: string;
  primaryKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
  defaultValue?: string | null;
};

type VisualTable = {
  id: string;
  name: string;
  x: number;
  y: number;
  /** HEX; линии от FK берут цвет исходной (дочерней) таблицы */
  color?: string;
  columns: VisualColumn[];
};

type VisualRelation = {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

/**
 * Рёберная точка «справа → слева» часто рисуется от родителя (PK) к потомку (FK).
 * В payload для БД нужно: from = таблица с внешним ключом, to = родительская колонка.
 */
function normalizeFkEndpoints(
  tables: VisualTable[],
  startTableId: string,
  startColId: string,
  endTableId: string,
  endColId: string,
): { fromTable: string; fromColumn: string; toTable: string; toColumn: string } | null {
  const st = tables.find((t) => t.id === startTableId);
  const et = tables.find((t) => t.id === endTableId);
  const sc = st?.columns.find((c) => c.id === startColId);
  const ec = et?.columns.find((c) => c.id === endColId);
  if (!st || !et || !sc || !ec) return null;

  const spk = Boolean(sc.primaryKey);
  const epk = Boolean(ec.primaryKey);

  if (epk && !spk) {
    return { fromTable: startTableId, fromColumn: startColId, toTable: endTableId, toColumn: endColId };
  }
  if (spk && !epk) {
    return { fromTable: endTableId, fromColumn: endColId, toTable: startTableId, toColumn: startColId };
  }

  const looksLikeFk = (col: VisualColumn) => /_id$/i.test(col.name) && !col.primaryKey;
  if (!spk && !epk) {
    const le = looksLikeFk(ec);
    const ls = looksLikeFk(sc);
    if (le && !ls) {
      return { fromTable: endTableId, fromColumn: endColId, toTable: startTableId, toColumn: startColId };
    }
    if (ls && !le) {
      return { fromTable: startTableId, fromColumn: startColId, toTable: endTableId, toColumn: endColId };
    }
  }

  return { fromTable: startTableId, fromColumn: startColId, toTable: endTableId, toColumn: endColId };
}

const TABLE_WIDTH = 340;
const HEADER_H = 36;
const ROW_H = 30;
const SQL_TYPES = [
  'INTEGER',
  'BIGINT',
  'BIGINT UNSIGNED',
  'INT',
  'SMALLINT',
  'SERIAL',
  'BIGINT AUTO_INCREMENT',
  'INTEGER AUTO_INCREMENT',
  'VARCHAR(255)',
  'VARCHAR(128)',
  'TEXT',
  'BOOLEAN',
  'TIMESTAMP',
  'DATETIME',
  'DATE',
  'UUID',
  'JSON',
  'JSONB',
  'DECIMAL(10,2)',
  'FLOAT',
  'DOUBLE',
];
const WORLD_OFFSET = 10000;
const WORLD_SIZE = WORLD_OFFSET * 2;
/** Высота нижней кнопки «+ столбец» в карточке (оценка для экспорта). */
const ER_TABLE_FOOTER_H = 38;

/** Запас по краям: вынос линии (EDGE_STUB/SAME_SIDE_LOOP) + маркер стрелки + погрешность html2canvas */
const ER_EXPORT_EDGE_PAD = 80;

function getErDiagramPixelBounds(
  tables: VisualTable[],
  edgeVertLists: Array<Array<{ x: number; y: number }>>,
): { minX: number; minY: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const bumpCanvas = (pathX: number, pathY: number) => {
    const cx = pathX + WORLD_OFFSET;
    const cy = pathY + WORLD_OFFSET;
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx);
    maxY = Math.max(maxY, cy);
  };

  for (const t of tables) {
    const left = t.x + WORLD_OFFSET;
    const top = t.y + WORLD_OFFSET;
    const right = left + TABLE_WIDTH;
    const bottom = top + HEADER_H + Math.max(t.columns.length, 1) * ROW_H + ER_TABLE_FOOTER_H;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  for (const verts of edgeVertLists) {
    for (const v of verts) {
      bumpCanvas(v.x, v.y);
    }
  }

  if (!Number.isFinite(minX)) return null;

  const pad = ER_EXPORT_EDGE_PAD;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return {
    minX,
    minY,
    width: Math.max(400, Math.ceil(maxX - minX)),
    height: Math.max(280, Math.ceil(maxY - minY)),
  };
}

/**
 * html2canvas часто «съедает» нижнюю часть текста в input/select при фиксированной высоте строки.
 * Вызывается из onclone по уже клонированному корню снимка.
 */
function prepareErDiagramCloneForExport(root: HTMLElement) {
  root.querySelectorAll('[data-table-node]').forEach((node) => {
    (node as HTMLElement).style.overflow = 'visible';
  });

  root.querySelectorAll('[data-er-table-header]').forEach((node) => {
    const h = node as HTMLElement;
    h.style.overflow = 'visible';
  });

  root.querySelectorAll('[data-er-header-main]').forEach((wrap) => {
    (wrap as HTMLElement).style.overflow = 'visible';
  });

  root.querySelectorAll('[data-er-table-title]').forEach((node) => {
    const el = node as HTMLElement;
    el.style.overflow = 'visible';
    el.style.lineHeight = '1.15';
    el.style.display = 'block';
    el.style.maxHeight = `${HEADER_H}px`;
    el.style.alignSelf = 'center';
  });

  root.querySelectorAll('[data-er-column-row]').forEach((row) => {
    const el = row as HTMLElement;
    el.style.overflow = 'visible';
    el.style.height = `${ROW_H}px`;
    el.style.minHeight = `${ROW_H}px`;
    el.style.maxHeight = `${ROW_H}px`;
    el.style.boxSizing = 'border-box';
    el.style.alignItems = 'center';
  });

  const readComputed = (el: Element) => {
    try {
      return window.getComputedStyle(el);
    } catch {
      return root.ownerDocument.defaultView!.getComputedStyle(el);
    }
  };

  root.querySelectorAll('input[data-er-field]').forEach((input) => {
    const inp = input as HTMLInputElement;
    const span = document.createElement('span');
    span.textContent = inp.value;
    const cs = readComputed(inp);
    span.style.cssText = [
      'flex:1',
      'min-width:0',
      `height:${ROW_H - 6}px`,
      'line-height:1.35',
      'display:flex',
      'align-items:center',
      'overflow:visible',
      'white-space:nowrap',
      'margin:0',
      'padding:0 6px',
      'box-sizing:border-box',
    ].join(';');
    span.style.fontSize = cs.fontSize;
    span.style.fontFamily = cs.fontFamily;
    span.style.fontWeight = cs.fontWeight;
    span.style.color = cs.color;
    inp.parentNode?.replaceChild(span, inp);
  });

  root.querySelectorAll('select[data-er-field]').forEach((select) => {
    const sel = select as HTMLSelectElement;
    const span = document.createElement('span');
    const opt = sel.options[sel.selectedIndex];
    span.textContent = opt ? opt.text : sel.value;
    const cs = readComputed(sel);
    span.style.cssText = [
      'flex-shrink:0',
      'max-width:132px',
      `height:${ROW_H - 6}px`,
      'line-height:1.35',
      'display:flex',
      'align-items:center',
      'overflow:visible',
      'white-space:nowrap',
      'margin:0',
      'padding:0 6px',
      'box-sizing:border-box',
    ].join(';');
    span.style.fontSize = cs.fontSize;
    span.style.fontFamily = cs.fontFamily;
    span.style.fontWeight = cs.fontWeight;
    span.style.color = cs.color;
    sel.parentNode?.replaceChild(span, sel);
  });
}

function getColumnY(table: VisualTable, colIndex: number): number {
  return table.y + HEADER_H + colIndex * ROW_H + ROW_H / 2;
}

const EDGE_STUB = 26;
const SAME_SIDE_LOOP = 52;

/** Ортогональные связи (только горизонтали и вертикали, углы 90°). */
function getSmartPath(
  fromTable: { x: number; y: number },
  fromColY: number,
  toTable: { x: number; y: number },
  toColY: number,
): {
  path: string;
  fromSide: 'left' | 'right';
  toSide: 'left' | 'right';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** В координатах пути до translate(WORLD_OFFSET) на группе SVG */
  verts: Array<{ x: number; y: number }>;
} {
  const fromCenterX = fromTable.x + TABLE_WIDTH / 2;
  const toCenterX = toTable.x + TABLE_WIDTH / 2;
  const GAP = 40;

  let fromSide: 'left' | 'right';
  let toSide: 'left' | 'right';

  if (fromTable.x + TABLE_WIDTH + GAP < toTable.x) {
    fromSide = 'right';
    toSide = 'left';
  } else if (toTable.x + TABLE_WIDTH + GAP < fromTable.x) {
    fromSide = 'left';
    toSide = 'right';
  } else if (fromCenterX <= toCenterX) {
    fromSide = 'right';
    toSide = 'right';
  } else {
    fromSide = 'left';
    toSide = 'left';
  }

  const startX = fromSide === 'right' ? fromTable.x + TABLE_WIDTH : fromTable.x;
  const endX = toSide === 'left' ? toTable.x : toTable.x + TABLE_WIDTH;
  const startY = fromColY;
  const endY = toColY;

  const sx = fromSide === 'right' ? startX + EDGE_STUB : startX - EDGE_STUB;
  const sy = startY;
  const ex = toSide === 'left' ? endX - EDGE_STUB : endX + EDGE_STUB;
  const ey = endY;

  const parts: string[] = [`M ${startX} ${startY}`, `L ${sx} ${sy}`];
  const verts: Array<{ x: number; y: number }> = [{ x: startX, y: startY }, { x: sx, y: sy }];
  const sameRow = Math.abs(sy - ey) < 0.5;
  const oppositeSides =
    (fromSide === 'right' && toSide === 'left') ||
    (fromSide === 'left' && toSide === 'right');

  if (oppositeSides) {
    if (sameRow) {
      parts.push(`L ${ex} ${ey}`, `L ${endX} ${endY}`);
      verts.push({ x: ex, y: ey }, { x: endX, y: endY });
    } else {
      const midX = (sx + ex) / 2;
      parts.push(`L ${midX} ${sy}`, `L ${midX} ${ey}`, `L ${ex} ${ey}`, `L ${endX} ${endY}`);
      verts.push({ x: midX, y: sy }, { x: midX, y: ey }, { x: ex, y: ey }, { x: endX, y: endY });
    }
  } else if (fromSide === 'right' && toSide === 'right') {
    const midX = Math.max(sx, ex) + SAME_SIDE_LOOP;
    parts.push(`L ${midX} ${sy}`, `L ${midX} ${ey}`, `L ${ex} ${ey}`, `L ${endX} ${endY}`);
    verts.push({ x: midX, y: sy }, { x: midX, y: ey }, { x: ex, y: ey }, { x: endX, y: endY });
  } else {
    const midX = Math.min(sx, ex) - SAME_SIDE_LOOP;
    parts.push(`L ${midX} ${sy}`, `L ${midX} ${ey}`, `L ${ex} ${ey}`, `L ${endX} ${endY}`);
    verts.push({ x: midX, y: sy }, { x: midX, y: ey }, { x: ex, y: ey }, { x: endX, y: endY });
  }

  return {
    path: parts.join(' '),
    fromSide,
    toSide,
    startX,
    startY,
    endX,
    endY,
    verts,
  };
}

function autoLayoutTables(schema: ConstructorSchema): { tables: VisualTable[]; relations: VisualRelation[] } {
  const tables = schema.tables.map((table, index) => ({
    id: table.id ?? table.name,
    name: table.name,
    x: typeof table.x === 'number' ? table.x : 60 + (index % 3) * 420,
    y: typeof table.y === 'number' ? table.y : 60 + Math.floor(index / 3) * 260,
    ...(table.color ? { color: table.color } : {}),
    columns: table.columns.map((column, columnIndex) => ({
      id: column.id ?? `${table.name}:${column.name}:${columnIndex}`,
      name: column.name,
      type: column.type,
      primaryKey: column.primaryKey,
      nullable: column.nullable,
      unique: column.unique,
      defaultValue: column.defaultValue,
    })),
  }));

  const tableById = new Map(tables.map((table) => [table.id, table]));
  const tableByName = new Map(tables.map((table) => [table.name, table]));

  const relations = (schema.relations ?? []).map((relation, index) => {
    const fromTable = tableByName.get(relation.fromTable) ?? tableById.get(relation.fromTable);
    const toTable = tableByName.get(relation.toTable) ?? tableById.get(relation.toTable);
    if (!fromTable || !toTable) return null;
    const fromColumn = fromTable.columns.find((column) => column.name === relation.fromColumn || column.id === relation.fromColumn);
    const toColumn = toTable.columns.find((column) => column.name === relation.toColumn || column.id === relation.toColumn);
    if (!fromColumn || !toColumn) return null;
    return {
      id: relation.id ?? `rel_${index}`,
      fromTable: fromTable.id,
      fromColumn: fromColumn.id,
      toTable: toTable.id,
      toColumn: toColumn.id,
    };
  }).filter(Boolean) as VisualRelation[];

  return { tables, relations };
}

function toConstructorPayload(tables: VisualTable[], relations: VisualRelation[]): ConstructorSchema {
  return {
    tables: tables.map((table) => ({
      id: table.id,
      name: table.name,
      x: table.x,
      y: table.y,
      ...(table.color ? { color: table.color } : {}),
      columns: table.columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        primaryKey: column.primaryKey,
        nullable: column.nullable,
        unique: column.unique,
        defaultValue: column.defaultValue,
      })),
    })),
    relations: relations.map((relation) => {
      const fromTable = tables.find((table) => table.id === relation.fromTable);
      const toTable = tables.find((table) => table.id === relation.toTable);
      const fromColumn = fromTable?.columns.find((column) => column.id === relation.fromColumn);
      const toColumn = toTable?.columns.find((column) => column.id === relation.toColumn);
      return {
        id: relation.id,
        fromTable: fromTable?.name ?? relation.fromTable,
        fromColumn: fromColumn?.name ?? relation.fromColumn,
        toTable: toTable?.name ?? relation.toTable,
        toColumn: toColumn?.name ?? relation.toColumn,
      };
    }),
  };
}


export default function DatabaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [deleteDbConfirmOpen, setDeleteDbConfirmOpen] = useState(false);
  const [deletingDb, setDeletingDb] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchDatabase(id)
      .then((d) => setDb(d || null))
      .finally(() => setLoading(false));
  }, [id]);

  const reloadDb = useCallback(async () => {
    if (!id) return;
    const next = await fetchDatabase(id);
    if (next) setDb(next);
  }, [id]);

  const handleDeleteDatabase = async () => {
    if (!db) return;
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
  if (!db) return <div className="text-center py-20 text-muted-foreground">База данных не найдена</div>;

  const canEdit = projectRoleAtLeast(db.myProjectRole, 'editor');
  const canAdmin = projectRoleAtLeast(db.myProjectRole, 'admin');

  if (db.engine === 'MongoDB') return <MongoDatabaseDetail db={db} reloadDb={reloadDb} />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Обзор' },
    { key: 'schema', label: 'Схема' },
    { key: 'constructor', label: 'Визуальный редактор' },
    { key: 'data', label: 'Данные' },
    { key: 'sql', label: 'SQL-редактор' },
    { key: 'migrations', label: 'Миграции' },
    { key: 'backups', label: 'Бэкапы' },
  ];

  return (
    <div className="space-y-6 animate-fade-in min-w-0 max-w-full overflow-x-hidden">
      <ConfirmModal
        open={deleteDbConfirmOpen}
        onOpenChange={setDeleteDbConfirmOpen}
        title="Удалить базу из проекта?"
        description={
          db.region === 'managed'
            ? 'Это управляемая база МояБД: будет удалён инстанс на платформе вместе с данными, пользователем БД и записями бэкапов/миграций в приложении. Действие необратимо.'
            : 'Это внешнее подключение: из проекта удалится только карточка и сохранённые бэкапы в МояБД. Сама база на вашем сервере не изменится.'
        }
        confirmLabel={db.region === 'managed' ? 'Удалить базу полностью' : 'Удалить подключение'}
        destructive
        confirmDisabled={deletingDb}
        onConfirm={() => void handleDeleteDatabase()}
      />

      <ManagedHealthBanner db={db} onSynced={reloadDb} allowHealthSync={canEdit} />

      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/databases')} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors shrink-0">
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

      <div className="border-b border-border overflow-x-auto max-w-full min-w-0 [-webkit-overflow-scrolling:touch]">
        <div className="flex gap-1 min-w-max">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <OverviewTab
          db={db}
          dbId={db.id}
          canRevealCredentials={canEdit}
          canMigrateSql={canAdmin}
          reloadDb={async () => {
            const next = await fetchDatabase(db.id);
            if (next) setDb(next);
          }}
        />
      )}
      {activeTab === 'schema' && <SchemaTab dbId={db.id} />}
      {activeTab === 'constructor' && <ConstructorTab dbId={db.id} canEditLayout={canEdit} canEditSchema={canAdmin} />}
      {activeTab === 'data' && <DataTab dbId={db.id} canEdit={canEdit} />}
      {activeTab === 'sql' && <SqlTab dbId={db.id} canEdit={canEdit} />}
      {activeTab === 'migrations' && <MigrationsTab dbId={db.id} dbEngine={db.engine} canApplyMigration={canAdmin} />}
      {activeTab === 'backups' && (
        <BackupsTab dbId={db.id} dbName={db.name} dbEngine={db.engine} canEdit={canEdit} canAdmin={canAdmin} />
      )}
    </div>
  );
}

function ConnectionReadonlyField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" aria-label={`Копировать: ${label}`} onClick={onCopy}>
          <Copy className="w-4 h-4" />
        </Button>
      </div>
      <Input readOnly value={value} className="font-mono text-sm h-11 rounded-xl bg-background" />
    </div>
  );
}

function OverviewTab({
  db,
  dbId,
  reloadDb,
  canRevealCredentials,
  canMigrateSql,
}: {
  db: Database;
  dbId: string;
  reloadDb: () => Promise<void>;
  canRevealCredentials: boolean;
  canMigrateSql: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<DatabaseConnectionInfo | null>(null);
  const [loadingConn, setLoadingConn] = useState(false);
  const [migrateConfirmOpen, setMigrateConfirmOpen] = useState(false);
  const [migratingEngine, setMigratingEngine] = useState(false);
  const { toast } = useToast();

  const sqlManagedMigrate =
    db.region === 'managed' && (db.engine === 'PostgreSQL' || db.engine === 'MySQL' || db.engine === 'MariaDB');

  const migrateTargetEngine: 'postgresql' | 'mysql' = db.engine === 'PostgreSQL' ? 'mysql' : 'postgresql';
  const migrateTargetLabel = migrateTargetEngine === 'mysql' ? 'MySQL' : 'PostgreSQL';

  const loadCredentials = useCallback(async () => {
    setLoadingConn(true);
    try {
      const info = await fetchDatabaseConnectionInfo(dbId);
      setConnectionInfo(info);
      return info;
    } catch (error: any) {
      toast({ title: 'Не удалось получить доступы', description: error.message, variant: 'destructive' });
      throw error;
    } finally {
      setLoadingConn(false);
    }
  }, [dbId, toast]);

  const handleReveal = async () => {
    try {
      if (!connectionInfo) await loadCredentials();
      setRevealed(true);
    } catch {
      /* сообщение уже в loadCredentials */
    }
  };

  const handleHide = () => {
    setRevealed(false);
    setShowPassword(false);
  };

  const copyValue = (value: string, title: string) => {
    void navigator.clipboard.writeText(value);
    toast({ title });
  };

  const handleMigrateSqlEngine = async () => {
    setMigratingEngine(true);
    try {
      await migrateManagedSqlEngine(dbId, { targetEngine: migrateTargetEngine });
      toast({
        title: 'СУБД изменена',
        description: `Данные перенесены на ${migrateTargetLabel}. Обновите вкладки при необходимости.`,
      });
      await reloadDb();
    } catch (error: any) {
      toast({
        title: 'Не удалось сменить СУБД',
        description: error.message ?? String(error),
        variant: 'destructive',
      });
    } finally {
      setMigratingEngine(false);
      setMigrateConfirmOpen(false);
    }
  };

  const engineHint = db.engine === 'PostgreSQL' ? 'PostgreSQL' : db.engine === 'MySQL' ? 'MySQL' : 'СУБД';

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <ConfirmModal
        open={migrateConfirmOpen}
        onOpenChange={setMigrateConfirmOpen}
        title={`Перевести базу на ${migrateTargetLabel}?`}
        description={
          'Будет сделан полный снимок текущих данных. Старый управляемый инстанс удалится с платформы, создастся новый и данные восстановятся на целевой СУБД. Записи бэкапов и история миграций в приложении будут удалены. Типы колонок и ограничения переносятся по правилам сопоставления; редкие типы могут стать TEXT или JSON. После ошибки на полпути карточка может получить статус «ошибка» — тогда безопаснее удалить её и создать базу заново.'
        }
        confirmLabel={`Перейти на ${migrateTargetLabel}`}
        destructive
        confirmDisabled={migratingEngine}
        onConfirm={() => void handleMigrateSqlEngine()}
      />

      <div className="bg-card rounded-2xl border border-border shadow-card p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-foreground text-lg">Подключение</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Учётные данные не показываются, пока вы их не запросите. После раскрытия можно копировать хост, порт, логин и пароль по отдельности — извлекать пароль только из URI не нужно.
          </p>
        </div>

        {!canRevealCredentials ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Полные параметры подключения и пароль доступны участникам с ролью редактор и выше.
            </p>
            <p className="text-xs font-mono text-muted-foreground/90 break-all">{db.connectionString}</p>
          </div>
        ) : !revealed ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Нажмите кнопку ниже, чтобы загрузить с сервера полные параметры доступа (в том числе пароль).
            </p>
            <Button variant="default" className="rounded-xl" disabled={loadingConn} onClick={() => void handleReveal()}>
              {loadingConn ? 'Загрузка…' : 'Показать параметры подключения'}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleHide}>
                Скрыть параметры
              </Button>
              {connectionInfo ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => copyValue(connectionInfo.connectionString, 'Строка подключения скопирована')}
                  >
                    <Copy className="w-4 h-4" /> Скопировать URI целиком
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => copyValue(connectionInfo.password, 'Пароль скопирован')}
                  >
                    <Copy className="w-4 h-4" /> Только пароль
                  </Button>
                </>
              ) : null}
            </div>

            {connectionInfo ? (
              <>
                <div className="rounded-xl border border-border bg-muted/25 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Строка подключения</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-lg"
                      aria-label="Копировать строку подключения"
                      onClick={() => copyValue(connectionInfo.connectionString, 'Строка подключения скопирована')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <code className="block text-xs font-mono text-foreground break-all leading-relaxed">{connectionInfo.connectionString}</code>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <ConnectionReadonlyField label="Host" value={connectionInfo.host} onCopy={() => copyValue(connectionInfo.host, 'Host скопирован')} />
                  <ConnectionReadonlyField
                    label="Порт"
                    value={String(connectionInfo.port)}
                    onCopy={() => copyValue(String(connectionInfo.port), 'Порт скопирован')}
                  />
                  <ConnectionReadonlyField
                    label="База данных"
                    value={connectionInfo.database}
                    onCopy={() => copyValue(connectionInfo.database, 'Имя базы скопировано')}
                  />
                  <ConnectionReadonlyField
                    label="Пользователь"
                    value={connectionInfo.user}
                    onCopy={() => copyValue(connectionInfo.user, 'Логин скопирован')}
                  />
                  <div className="sm:col-span-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">Пароль</Label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                          onClick={() => setShowPassword((v) => !v)}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          aria-label="Копировать пароль"
                          onClick={() => copyValue(connectionInfo.password, 'Пароль скопирован')}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <Input
                      readOnly
                      type={showPassword ? 'text' : 'password'}
                      value={connectionInfo.password}
                      className="font-mono text-sm h-11 rounded-xl bg-background"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Metric label="SSL" value={connectionInfo.ssl ? 'Включён' : 'Выключен'} />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Параметры недоступны.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border">
          <Metric label="Подключения" value={`${db.connections}`} />
          <Metric label="Создана" value={new Date(db.createdAt).toLocaleDateString()} />
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card p-5 space-y-4">
        <h3 className="font-semibold text-foreground">О платформе</h3>
        <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground leading-relaxed">
          Эта база подключена к МояБД. Вкладки выше позволяют смотреть схему, править таблицы, выполнять SQL, делать бэкапы и работать с визуальным редактором.
        </div>
        <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground leading-relaxed">
          Для доступа из своих приложений используйте поля слева или полную строку URI. Для управляемых баз {engineHint} платформа может подставлять публичный адрес вместо внутреннего{' '}
          <span className="font-mono text-foreground/90">127.0.0.1</span>
          — это настраивается на сервере.
        </div>

        {sqlManagedMigrate && canMigrateSql && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-4 space-y-3">
            <h4 className="font-medium text-foreground text-sm">Смена СУБД (PostgreSQL ↔ MySQL)</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Только для управляемых баз: полный перенос таблиц и строк между PostgreSQL и MySQL на стороне платформы. Внешние подключения используйте через выгрузку SQL или JSON-бэкапа вручную.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl border-amber-500/40"
              disabled={db.status !== 'running' || migratingEngine}
              onClick={() => setMigrateConfirmOpen(true)}
            >
              Перенести на {migrateTargetLabel}…
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SchemaTab({ dbId }: { dbId: string }) {
  const [search, setSearch] = useState('');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setTables(await fetchSchema(dbId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dbId]);

  const filtered = tables.filter((table) => table.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Input placeholder="Поиск таблиц…" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-xl" />
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Обновить</Button>
      </div>
      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/30">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Таблица</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Столбцы</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden sm:table-cell">Строки</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Размер</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b border-border/50"><td colSpan={4} className="py-3 px-4"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="py-8 px-4 text-center text-muted-foreground">Таблицы не найдены</td></tr>
            ) : filtered.map((t) => (
              <tr key={t.name} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                <td className="py-3 px-4 font-medium text-foreground font-mono text-xs">{t.name}</td>
                <td className="py-3 px-4 text-muted-foreground">{t.columns}</td>
                <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell">{t.rows.toLocaleString()}</td>
                <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{t.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



function ConstructorTab({
  dbId,
  canEditLayout,
  canEditSchema,
}: {
  dbId: string;
  canEditLayout: boolean;
  canEditSchema: boolean;
}) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<VisualTable[]>([]);
  const [relations, setRelations] = useState<VisualRelation[]>([]);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; originPanX: number; originPanY: number } | null>(null);
  const [editTable, setEditTable] = useState<VisualTable | null>(null);
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [connecting, setConnecting] = useState<{ tableId: string; colId: string } | null>(null);
  const [connectMouse, setConnectMouse] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hasSchemaChanges, setHasSchemaChanges] = useState(false);
  const [exportingDiagram, setExportingDiagram] = useState(false);

  const draggingRef = useRef<typeof dragging>(null);
  const panningRef = useRef<typeof panning>(null);
  const tablesRef = useRef(tables);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  tablesRef.current = tables;
  zoomRef.current = zoom;
  panRef.current = pan;

  const persistLayout = useCallback(async (nextTables: VisualTable[], nextViewport = { zoom, panX: pan.x, panY: pan.y }) => {
    if (!canEditLayout) return;
    try {
      const tableColors: Record<string, string> = {};
      for (const t of nextTables) {
        if (t.color) tableColors[t.name] = t.color;
      }
      await saveConstructorLayout(dbId, {
        layout: Object.fromEntries(nextTables.map((table) => [table.name, { x: table.x, y: table.y }])),
        viewport: nextViewport,
        tableColors,
      });
    } catch (error: any) {
      console.error('Failed to save constructor layout', error);
    }
  }, [dbId, zoom, pan.x, pan.y, canEditLayout]);

  const schedulePersistLayout = useCallback((nextTables: VisualTable[], nextViewport = { zoom, panX: pan.x, panY: pan.y }) => {
    if (!canEditLayout) return;
    if (!hasLoadedRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      persistLayout(nextTables, nextViewport);
    }, 400);
  }, [persistLayout, zoom, pan.x, pan.y, canEditLayout]);

  const load = async () => {
    setLoading(true);
    try {
      const schema = await fetchConstructor(dbId);
      const visual = autoLayoutTables(schema);
      setTables(visual.tables);
      setRelations(visual.relations);
      setZoom(schema.viewport?.zoom ?? 1);
      setPan({ x: schema.viewport?.panX ?? (-WORLD_OFFSET + 80), y: schema.viewport?.panY ?? (-WORLD_OFFSET + 80) });
      setHasSchemaChanges(false);
      hasLoadedRef.current = true;
    } catch (error: any) {
      toast({ title: 'Не удалось загрузить редактор', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dbId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom - WORLD_OFFSET,
      y: (clientY - rect.top - pan.y) / zoom - WORLD_OFFSET,
    };
  }, [pan.x, pan.y, zoom]);

  useEffect(() => {
    if (!dragging && !panning && !connecting) return;
    const move = (ev: PointerEvent) => {
      const d = draggingRef.current;
      if (d) {
        const point = clientToCanvas(ev.clientX, ev.clientY);
        setTables((prev) => prev.map((table) => table.id === d.id ? {
          ...table,
          x: point.x - d.offsetX,
          y: point.y - d.offsetY,
        } : table));
      }
      const p = panningRef.current;
      if (p) {
        const next = { x: p.originPanX + (ev.clientX - p.startX), y: p.originPanY + (ev.clientY - p.startY) };
        panRef.current = next;
        setPan(next);
      }
      if (connecting) {
        const point = clientToCanvas(ev.clientX, ev.clientY);
        setConnectMouse(point);
      }
    };
    const end = () => {
      const hadDrag = !!draggingRef.current;
      const hadPan = !!panningRef.current;
      draggingRef.current = null;
      panningRef.current = null;
      setDragging(null);
      setPanning(null);
      if (hadDrag) schedulePersistLayout(tablesRef.current);
      if (hadPan) schedulePersistLayout(tablesRef.current, { zoom: zoomRef.current, panX: panRef.current.x, panY: panRef.current.y });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging, panning, connecting, clientToCanvas, schedulePersistLayout]);

  const handleTablePointerDown = (event: React.PointerEvent, tableId: string) => {
    if (!canEditLayout) return;
    if (connecting) return;
    event.stopPropagation();
    event.preventDefault();
    const table = tables.find((item) => item.id === tableId);
    if (!table) return;
    const point = clientToCanvas(event.clientX, event.clientY);
    const next = { id: tableId, offsetX: point.x - table.x, offsetY: point.y - table.y };
    draggingRef.current = next;
    setDragging(next);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement)?.closest('[data-table-node="true"]')) return;
    if ((event.target as HTMLElement)?.closest('[data-er-relation-hit]')) return;
    if ((event.target as HTMLElement)?.closest('input,select,textarea,button,a')) return;
    if (connecting) {
      cancelConnect();
      return;
    }
    event.preventDefault();
    const next = { startX: event.clientX, startY: event.clientY, originPanX: pan.x, originPanY: pan.y };
    panningRef.current = next;
    setPanning(next);
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = clientToCanvas(event.clientX, event.clientY);
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    const nextZoom = Math.min(2.5, Math.max(0.4, Number((zoom + delta).toFixed(2))));
    const nextPanX = event.clientX - rect.left - (point.x + WORLD_OFFSET) * nextZoom;
    const nextPanY = event.clientY - rect.top - (point.y + WORLD_OFFSET) * nextZoom;
    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
    schedulePersistLayout(tables, { zoom: nextZoom, panX: nextPanX, panY: nextPanY });
  };

  const zoomBy = (delta: number) => {
    const nextZoom = Math.min(2.5, Math.max(0.4, Number((zoom + delta).toFixed(2))));
    setZoom(nextZoom);
    schedulePersistLayout(tables, { zoom: nextZoom, panX: pan.x, panY: pan.y });
  };

  const resetViewport = () => {
    setZoom(1);
    setPan({ x: -WORLD_OFFSET + 80, y: -WORLD_OFFSET + 80 });
    schedulePersistLayout(tables, { zoom: 1, panX: -WORLD_OFFSET + 80, panY: -WORLD_OFFSET + 80 });
  };

  const fitToScreen = () => {
    if (!canvasRef.current || tables.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const minX = Math.min(...tables.map((table) => table.x));
    const minY = Math.min(...tables.map((table) => table.y));
    const maxX = Math.max(...tables.map((table) => table.x + TABLE_WIDTH));
    const maxY = Math.max(...tables.map((table) => table.y + HEADER_H + Math.max(table.columns.length, 1) * ROW_H + 40));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const nextZoom = Math.min(1.5, Math.max(0.4, Number(Math.min((rect.width - 80) / width, (rect.height - 80) / height).toFixed(2))));
    const nextPanX = (rect.width - width * nextZoom) / 2 - (minX + WORLD_OFFSET) * nextZoom;
    const nextPanY = (rect.height - height * nextZoom) / 2 - (minY + WORLD_OFFSET) * nextZoom;
    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
    schedulePersistLayout(tables, { zoom: nextZoom, panX: nextPanX, panY: nextPanY });
  };

  const startConnect = (event: React.PointerEvent, tableId: string, colId: string) => {
    if (!canEditSchema) return;
    event.stopPropagation();
    event.preventDefault();
    setConnecting({ tableId, colId });
    const point = clientToCanvas(event.clientX, event.clientY);
    setConnectMouse(point);
  };

  const endConnect = (event: React.PointerEvent, tableId: string, colId: string) => {
    if (!canEditSchema) return;
    event.stopPropagation();
    if (!connecting || connecting.tableId === tableId) {
      setConnecting(null);
      setConnectMouse(null);
      return;
    }

    const normalized = normalizeFkEndpoints(tables, connecting.tableId, connecting.colId, tableId, colId);
    if (!normalized) {
      setConnecting(null);
      setConnectMouse(null);
      return;
    }

    const exists = relations.some((relation) =>
      relation.fromTable === normalized.fromTable
      && relation.fromColumn === normalized.fromColumn
      && relation.toTable === normalized.toTable
      && relation.toColumn === normalized.toColumn,
    );

    if (!exists) {
      setRelations((prev) => [...prev, {
        id: `rel_${Date.now()}`,
        ...normalized,
      }]);
      setHasSchemaChanges(true);
      toast({ title: 'Связь создана' });
    }

    setConnecting(null);
    setConnectMouse(null);
  };

  const cancelConnect = () => {
    setConnecting(null);
    setConnectMouse(null);
  };

  const addTable = () => {
    if (!canEditSchema) return;
    if (!newTableName.trim()) return;
    const tableId = `t_${Date.now()}`;
    const nextTables = [...tables, {
      id: tableId,
      name: newTableName.trim(),
      x: 80 + (tables.length % 3) * 420,
      y: 80 + Math.floor(tables.length / 3) * 260,
      columns: [{ id: `c_${Date.now()}`, name: 'id', type: 'SERIAL', primaryKey: true, nullable: false }],
    }];
    setTables(nextTables);
    setAddTableOpen(false);
    setNewTableName('');
    setHasSchemaChanges(true);
    schedulePersistLayout(nextTables);
    toast({ title: 'Таблица создана' });
  };

  const deleteTable = (tableId: string) => {
    if (!canEditSchema) return;
    const nextTables = tables.filter((table) => table.id !== tableId);
    setTables(nextTables);
    setRelations((prev) => prev.filter((relation) => relation.fromTable !== tableId && relation.toTable !== tableId));
    setEditTable(null);
    setHasSchemaChanges(true);
    schedulePersistLayout(nextTables);
    toast({ title: 'Таблица удалена' });
  };

  const addColumn = (tableId: string) => {
    if (!canEditSchema) return;
    const newColumn = { id: `c_${Date.now()}`, name: 'new_column', type: 'VARCHAR(255)', nullable: true };
    setTables((prev) => prev.map((table) => table.id === tableId ? { ...table, columns: [...table.columns, newColumn] } : table));
    setHasSchemaChanges(true);
    setEditTable((prev) => prev ? {
      ...prev,
      columns: prev.id === tableId ? [...prev.columns, newColumn] : prev.columns,
    } : prev);
  };

  const updateColumn = (tableId: string, columnId: string, patch: Partial<VisualColumn>) => {
    if (!canEditSchema) return;
    setHasSchemaChanges(true);
    setTables((prev) => prev.map((table) => table.id === tableId ? {
      ...table,
      columns: table.columns.map((column) => column.id === columnId ? { ...column, ...patch } : column),
    } : table));
    setEditTable((prev) => prev && prev.id === tableId ? {
      ...prev,
      columns: prev.columns.map((column) => column.id === columnId ? { ...column, ...patch } : column),
    } : prev);
  };

  const updateTableColor = (tableId: string, hex: string) => {
    if (!canEditLayout) return;
    setHasSchemaChanges(true);
    const nextTables = tables.map((table) => (table.id === tableId ? { ...table, color: hex } : table));
    setTables(nextTables);
    setEditTable((prev) => (prev && prev.id === tableId ? { ...prev, color: hex } : prev));
    schedulePersistLayout(nextTables);
  };

  const clearTableColor = (tableId: string) => {
    if (!canEditLayout) return;
    setHasSchemaChanges(true);
    const nextTables = tables.map((table) => (table.id === tableId ? { ...table, color: undefined } : table));
    setTables(nextTables);
    setEditTable((prev) => {
      if (!prev || prev.id !== tableId) return prev;
      const { color: _c, ...rest } = prev;
      return rest as VisualTable;
    });
    schedulePersistLayout(nextTables);
  };

  const deleteColumn = (tableId: string, columnId: string) => {
    if (!canEditSchema) return;
    setHasSchemaChanges(true);
    setTables((prev) => prev.map((table) => table.id === tableId ? {
      ...table,
      columns: table.columns.filter((column) => column.id !== columnId),
    } : table));
    setRelations((prev) => prev.filter((relation) => relation.fromColumn !== columnId && relation.toColumn !== columnId));
    setEditTable((prev) => prev && prev.id === tableId ? {
      ...prev,
      columns: prev.columns.filter((column) => column.id !== columnId),
    } : prev);
  };

  const deleteRelation = (relationId: string) => {
    if (!canEditSchema) return;
    setHasSchemaChanges(true);
    setRelations((prev) => prev.filter((relation) => relation.id !== relationId));
    toast({ title: 'Связь удалена', description: 'Сохраните схему, чтобы применить изменения в БД.' });
  };

  const relationLines = useMemo(() => relations.map((relation) => {
    const fromTable = tables.find((table) => table.id === relation.fromTable);
    const toTable = tables.find((table) => table.id === relation.toTable);
    if (!fromTable || !toTable) return null;
    const fromIndex = fromTable.columns.findIndex((column) => column.id === relation.fromColumn);
    const toIndex = toTable.columns.findIndex((column) => column.id === relation.toColumn);
    if (fromIndex < 0 || toIndex < 0) return null;
    const stroke = fromTable.color?.trim() ? fromTable.color : 'hsl(var(--primary))';
    return {
      id: relation.id,
      stroke,
      ...getSmartPath(fromTable, getColumnY(fromTable, fromIndex), toTable, getColumnY(toTable, toIndex)),
    };
  }).filter(Boolean) as Array<{ id: string; stroke: string; path: string; verts: Array<{ x: number; y: number }>; fromSide: 'left' | 'right'; toSide: 'left' | 'right'; startX: number; startY: number; endX: number; endY: number }>, [relations, tables]);

  const connectingLine = useMemo(() => {
    if (!connecting || !connectMouse) return null;
    const fromTable = tables.find((table) => table.id === connecting.tableId);
    if (!fromTable) return null;
    const fromIndex = fromTable.columns.findIndex((column) => column.id === connecting.colId);
    if (fromIndex < 0) return null;
    return getSmartPath(fromTable, getColumnY(fromTable, fromIndex), { x: connectMouse.x - TABLE_WIDTH / 2, y: connectMouse.y }, connectMouse.y).path;
  }, [connecting, connectMouse, tables]);

  const save = async () => {
    if (!canEditSchema) return;
    setSaving(true);
    try {
      const tableColors: Record<string, string> = {};
      for (const t of tables) {
        if (t.color) tableColors[t.name] = t.color;
      }
      await applyConstructor(dbId, {
        ...toConstructorPayload(tables, relations),
        tableColors,
        viewport: { zoom, panX: pan.x, panY: pan.y },
      });
      await persistLayout(tables, { zoom, panX: pan.x, panY: pan.y });
      setHasSchemaChanges(false);
      toast({ title: 'Схема сохранена' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось применить схему', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const exportDiagram = async (format: 'png' | 'jpeg') => {
    const el = canvasRef.current;
    if (!el || exportingDiagram) return;
    setExportingDiagram(true);

    const raw = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    const hslBg = raw ? `hsl(${raw})` : '#fafafa';
    const computedCanvasBg = el ? getComputedStyle(el).backgroundColor : '';
    const bg =
      computedCanvasBg && computedCanvasBg !== 'rgba(0, 0, 0, 0)' && computedCanvasBg !== 'transparent'
        ? computedCanvasBg
        : hslBg;

    await (document.fonts?.ready?.catch(() => undefined) ?? Promise.resolve());

    const world = el.querySelector('[data-er-export-world]') as HTMLElement | null;
    const bounds = getErDiagramPixelBounds(tables, relationLines.map((line) => line.verts));

    let shell: HTMLDivElement | null = null;
    let captureEl: HTMLElement = el;

    try {
      const { default: html2canvas } = await import('html2canvas');

      if (world && bounds) {
        shell = document.createElement('div');
        shell.className = 'er-diagram-exporting rounded-2xl border border-border shadow-none';
        const fgRaw = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
        const fg = fgRaw ? `hsl(${fgRaw})` : undefined;
        shell.style.cssText = [
          'position:fixed',
          'left:-12000px',
          'top:0',
          `width:${bounds.width}px`,
          `height:${bounds.height}px`,
          'overflow:hidden',
          'font-family:Inter,system-ui,sans-serif',
          `-webkit-font-smoothing:antialiased`,
          `background:${bg}`,
          ...(fg ? [`color:${fg}`] : []),
        ].join(';');

        const innerClone = world.cloneNode(true) as HTMLElement;
        innerClone.classList.add('er-diagram-exporting');
        innerClone.style.position = 'absolute';
        innerClone.style.left = '0';
        innerClone.style.top = '0';
        innerClone.style.transform = `translate(${-bounds.minX}px, ${-bounds.minY}px)`;
        innerClone.style.transformOrigin = '0 0';
        innerClone.style.willChange = 'auto';

        shell.appendChild(innerClone);
        document.body.appendChild(shell);

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

        captureEl = shell;
      } else {
        el.classList.add('er-diagram-exporting');
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }

      const snapshot = await html2canvas(captureEl, {
        scale: 2,
        backgroundColor: bg,
        useCORS: true,
        logging: false,
        foreignObjectRendering: false,
        onclone: (_clonedDoc, clonedEl) => {
          prepareErDiagramCloneForExport(clonedEl);
        },
      });

      const url =
        format === 'jpeg'
          ? snapshot.toDataURL('image/jpeg', 0.92)
          : snapshot.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `er-diagram-${dbId}-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      a.click();
      toast({ title: format === 'jpeg' ? 'Диаграмма сохранена как JPG' : 'Диаграмма сохранена как PNG' });
    } catch (error: any) {
      toast({ title: 'Не удалось экспортировать', description: error?.message ?? 'Попробуйте ещё раз', variant: 'destructive' });
    } finally {
      el.classList.remove('er-diagram-exporting');
      if (shell?.parentNode) {
        shell.parentNode.removeChild(shell);
      }
      setExportingDiagram(false);
    }
  };

  if (loading) return <div className="h-[640px] rounded-2xl border border-border bg-card p-6"><Skeleton className="h-full w-full rounded-2xl" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        {canEditSchema ? (
          <>
            <Button variant="hero" onClick={() => setAddTableOpen(true)}><Plus className="w-4 h-4" /> Добавить таблицу</Button>
            <Button variant={connecting ? 'hero' : 'outline'} onClick={connecting ? cancelConnect : () => toast({ title: 'Режим связи', description: 'Потяните от правой точки к левой. Направление произвольное: от родителя (PK) к потомку (FK) или наоборот — сохранится корректный внешний ключ.' })}>
              <Settings className="w-4 h-4" /> {connecting ? 'Отменить связь' : 'Связать'}
            </Button>
          </>
        ) : null}
        <Button variant="outline" onClick={() => zoomBy(0.1)}>+</Button>
        <Button variant="outline" onClick={() => zoomBy(-0.1)}>-</Button>
        <Button variant="outline" onClick={resetViewport}>{Math.round(zoom * 100)}%</Button>
        <Button variant="outline" onClick={fitToScreen}>Fit</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={exportingDiagram}>
              <ImageDown className="w-4 h-4" /> {exportingDiagram ? 'Экспорт…' : 'Экспорт'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem onClick={() => void exportDiagram('png')}>Сохранить как PNG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportDiagram('jpeg')}>Сохранить как JPG</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4" /> Обновить</Button>
        {canEditSchema ? (
          <Button variant="outline" onClick={save} disabled={saving || !hasSchemaChanges}><Save className="w-4 h-4" /> {saving ? 'Сохраняем…' : 'Сохранить схему'}</Button>
        ) : null}
      </div>

      <div
        ref={canvasRef}
        className="relative min-h-[280px] h-[min(70vh,640px)] md:h-[640px] rounded-2xl border border-border bg-muted/35 overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={handleCanvasPointerDown}
        onWheel={handleWheel}
      >
        <div
          className="absolute inset-0 bg-card/40"
          aria-hidden
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--border)) 1px, transparent 0)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            opacity: 0.55,
          }}
        />

        <div
          data-er-export-world
          className="absolute left-0 top-0 will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: WORLD_SIZE,
            height: WORLD_SIZE,
          }}
        >
          <svg className="absolute inset-0 overflow-visible" width={WORLD_SIZE} height={WORLD_SIZE}>
            <defs>
              {relationLines.map((line, idx) => (
                <marker key={`mk-${line.id}-${idx}`} id={`er-arrow-${idx}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={line.stroke} />
                </marker>
              ))}
            </defs>
            {relationLines.map((line, idx) => (
              <g key={line.id} className="pointer-events-auto touch-manipulation" transform={`translate(${WORLD_OFFSET} ${WORLD_OFFSET})`}>
                <path d={line.path} fill="none" stroke={line.stroke} strokeWidth="2" strokeLinejoin="round" markerEnd={`url(#er-arrow-${idx})`} pointerEvents="none" />
                {canEditSchema ? (
                  <path
                    data-er-relation-hit
                    d={line.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={32}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="cursor-pointer"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      deleteRelation(line.id);
                    }}
                  />
                ) : null}
              </g>
            ))}
            {connectingLine && <path d={connectingLine} transform={`translate(${WORLD_OFFSET} ${WORLD_OFFSET})`} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" strokeDasharray="6 4" opacity="0.5" />}
          </svg>

          {tables.map((table) => (
            <div
              key={table.id}
              data-table-node="true"
              data-table-id={table.id}
              className="absolute bg-card rounded-xl border border-border shadow-card select-none touch-manipulation"
              style={{
                left: table.x + WORLD_OFFSET,
                top: table.y + WORLD_OFFSET,
                width: TABLE_WIDTH,
                zIndex: dragging?.id === table.id ? 10 : 3,
                ...(table.color ? { borderColor: table.color, boxShadow: `0 1px 3px 0 ${table.color}22` } : {}),
              }}
            >
              <div
                data-er-table-header
                className={`flex items-center justify-between px-3 rounded-t-xl bg-primary/10 border-b border-border ${canEditLayout ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-default'}`}
                style={{ height: HEADER_H }}
                onPointerDown={(event) => handleTablePointerDown(event, table.id)}
              >
                <div data-er-header-main className="flex items-center gap-2 overflow-hidden min-w-0">
                  <GripVertical data-er-chrome className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span data-er-table-title className="text-sm font-bold text-foreground font-mono truncate">{table.name}</span>
                  <span data-er-chrome className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">{table.columns.length} кол.</span>
                  {canEditLayout ? (
                  <div data-er-chrome className="flex items-center gap-0.5 shrink-0" onPointerDown={(event) => event.stopPropagation()}>
                    <input
                      type="color"
                      value={table.color ?? '#64748b'}
                      title="Цвет таблицы и исходящих связей"
                      aria-label="Цвет таблицы"
                      className="h-5 w-7 cursor-pointer rounded border border-border/60 bg-transparent p-0 shrink-0"
                      onChange={(event) => updateTableColor(table.id, event.target.value)}
                    />
                    {table.color ? (
                      <button type="button" className="text-[11px] leading-none text-muted-foreground hover:text-foreground px-0.5" title="Сбросить цвет" onClick={() => clearTableColor(table.id)}>
                        ×
                      </button>
                    ) : null}
                  </div>
                  ) : null}
                </div>
                {canEditSchema ? (
                <div data-er-chrome className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => setEditTable(table)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                    <Settings className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => deleteTable(table.id)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                ) : <div data-er-chrome className="w-6 shrink-0" />}
              </div>

              <div>
                {table.columns.map((column, index) => {
                  const hasRelFrom = relations.some((relation) => relation.fromTable === table.id && relation.fromColumn === column.id);
                  const hasRelTo = relations.some((relation) => relation.toTable === table.id && relation.toColumn === column.id);
                  const isConnectingThis = connecting?.tableId === table.id && connecting.colId === column.id;
                  const isFkSource = relations.some((relation) => relation.fromTable === table.id && relation.fromColumn === column.id);
                  return (
                    <div
                      key={column.id}
                      data-er-column-row
                      className={`relative flex items-center gap-1.5 px-2 text-xs transition-colors ${isConnectingThis ? 'bg-primary/10' : 'hover:bg-secondary/30'} ${index < table.columns.length - 1 ? 'border-b border-border/30' : ''}`}
                      style={{ height: ROW_H }}
                    >
                      <div
                        data-er-row-handle
                        className={`absolute -left-[10px] top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full border-2 border-primary cursor-pointer transition-all z-10 touch-manipulation ${hasRelTo ? 'bg-primary scale-100' : 'bg-card hover:bg-primary/30 scale-75 hover:scale-100'} ${connecting ? 'scale-100 bg-primary/20' : ''}`}
                        onPointerUp={(event) => endConnect(event, table.id, column.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                      <div
                        data-er-row-handle
                        className={`absolute -right-[10px] top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full border-2 border-primary cursor-pointer transition-all z-10 touch-manipulation ${hasRelFrom ? 'bg-primary scale-100' : 'bg-card hover:bg-primary/30 scale-75 hover:scale-100'} ${isConnectingThis ? 'bg-primary ring-2 ring-primary/30 scale-110' : ''}`}
                        onPointerDown={(event) => startConnect(event, table.id, column.id)}
                      />
                      <span className={`w-4 shrink-0 text-center font-bold text-[10px] ${column.primaryKey ? 'text-warning' : isFkSource ? 'text-primary' : 'text-muted-foreground/30'}`}>
                        {column.primaryKey ? '🔑' : isFkSource ? '🔗' : '·'}
                      </span>
                      <Input
                        data-er-field
                        value={column.name}
                        onChange={(event) => updateColumn(table.id, column.id, { name: event.target.value })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        className="h-6 min-w-0 flex-1 px-1.5 py-0 text-xs font-mono rounded-md border-border/60 bg-background/80 focus-visible:ring-1 focus-visible:ring-ring"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <select
                        data-er-field
                        value={column.type}
                        onChange={(event) => updateColumn(table.id, column.id, { type: event.target.value })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        className="h-6 max-w-[132px] shrink-0 rounded-md border border-border/60 bg-background px-1 text-[10px] font-mono text-foreground"
                        title={column.type}
                      >
                        {!SQL_TYPES.includes(column.type) ? <option value={column.type}>{column.type}</option> : null}
                        {SQL_TYPES.map((dataType) => (
                          <option key={dataType} value={dataType}>
                            {dataType}
                          </option>
                        ))}
                      </select>
                      {column.nullable && <span className="text-muted-foreground/40 text-[9px] shrink-0 w-3 text-center">N</span>}
                    </div>
                  );
                })}
              </div>

              <button type="button" data-er-add-column onClick={() => addColumn(table.id)} className="w-full px-3 py-1.5 text-xs text-primary hover:bg-primary/5 rounded-b-xl transition-colors text-left">
                + Добавить столбец
              </button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={addTableOpen} onOpenChange={setAddTableOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader><DialogTitle>Новая таблица</DialogTitle></DialogHeader>
          <div>
            <Label>Название таблицы</Label>
            <Input value={newTableName} onChange={(event) => setNewTableName(event.target.value)} placeholder="my_table" className="mt-1.5 rounded-xl font-mono" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTableOpen(false)}>Отмена</Button>
            <Button variant="hero" onClick={addTable}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTable} onOpenChange={() => setEditTable(null)}>
        <DialogContent className="rounded-2xl max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Редактировать: {editTable?.name}</DialogTitle></DialogHeader>
          {editTable && (
            <div className="space-y-4">
              <div>
                <Label>Название</Label>
                <Input
                  value={editTable.name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setHasSchemaChanges(true);
                    setEditTable((prev) => prev ? { ...prev, name: value } : null);
                    setTables((prev) => prev.map((table) => table.id === editTable.id ? { ...table, name: value } : table));
                  }}
                  className="mt-1.5 rounded-xl font-mono"
                />
              </div>
              <div>
                <Label>Цвет на диаграмме</Label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input
                    type="color"
                    value={editTable.color ?? '#64748b'}
                    className="h-9 w-14 cursor-pointer rounded-lg border border-border bg-transparent"
                    onChange={(event) => updateTableColor(editTable.id, event.target.value)}
                  />
                  {editTable.color ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => clearTableColor(editTable.id)}>Сбросить цвет</Button>
                  ) : null}
                  <span className="text-xs text-muted-foreground">Связи от столбцов с внешним ключом этой таблицы рисуются этим цветом.</span>
                </div>
              </div>
              <div>
                <Label>Столбцы</Label>
                <div className="mt-2 space-y-2">
                  {editTable.columns.map((column) => (
                    <div key={column.id} className="flex items-center gap-2 p-2 rounded-xl bg-secondary/30">
                      <Input
                        value={column.name}
                        onChange={(event) => updateColumn(editTable.id, column.id, { name: event.target.value })}
                        className="rounded-lg h-8 text-xs font-mono flex-1"
                      />
                      <select
                        value={column.type}
                        onChange={(event) => updateColumn(editTable.id, column.id, { type: event.target.value })}
                        className="h-8 px-2 rounded-lg border border-border bg-card text-xs text-foreground"
                      >
                        {SQL_TYPES.map((dataType) => <option key={dataType} value={dataType}>{dataType}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input type="checkbox" checked={Boolean(column.primaryKey)} onChange={(event) => updateColumn(editTable.id, column.id, { primaryKey: event.target.checked, nullable: event.target.checked ? false : column.nullable })} className="rounded" /> PK
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input type="checkbox" checked={Boolean(column.nullable)} onChange={(event) => updateColumn(editTable.id, column.id, { nullable: event.target.checked })} className="rounded" /> NULL
                      </label>
                      <button onClick={() => deleteColumn(editTable.id, column.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addColumn(editTable.id)}>
                    <Plus className="w-3.5 h-3.5" /> Добавить столбец
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTable(null)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function DataTab({ dbId, canEdit }: { dbId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Record<string, any> | null>(null);
  const [truncateOpen, setTruncateOpen] = useState(false);
  const [truncating, setTruncating] = useState(false);

  const primaryKey = useMemo(() => columns.find((column) => column === 'id') ?? columns[0], [columns]);

  const loadTables = async () => {
    const schema = await fetchSchema(dbId);
    setTables(schema);
    if (!selectedTable && schema[0]) {
      setSelectedTable(schema[0].name);
    }
    return schema;
  };

  const loadRows = async (tableName: string) => {
    if (!tableName) return;
    setLoading(true);
    try {
      const data = await fetchTableData(dbId, tableName, 50, 0);
      setColumns(data.columns);
      setRows(data.rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables().catch(() => undefined);
  }, [dbId]);

  useEffect(() => {
    if (selectedTable) {
      setDraft({});
      loadRows(selectedTable).catch(() => undefined);
    }
  }, [selectedTable]);

  const submitInsert = async () => {
    if (!canEdit) return;
    if (!selectedTable) return;
    const payload = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ''));
    try {
      await insertTableRow(dbId, selectedTable, payload);
      toast({ title: 'Строка добавлена' });
      setDraft({});
      await loadRows(selectedTable);
    } catch (error: any) {
      toast({ title: 'Не удалось добавить строку', description: error.message, variant: 'destructive' });
    }
  };

  const submitDelete = async () => {
    if (!canEdit) return;
    if (!selectedTable || !deleteTarget || !primaryKey) return;
    try {
      await deleteTableRow(dbId, selectedTable, primaryKey, deleteTarget[primaryKey]);
      toast({ title: 'Строка удалена' });
      setDeleteTarget(null);
      await loadRows(selectedTable);
    } catch (error: any) {
      toast({ title: 'Не удалось удалить строку', description: error.message, variant: 'destructive' });
    }
  };

  const submitQuickEdit = async (row: Record<string, any>) => {
    if (!canEdit) return;
    if (!selectedTable || !primaryKey) return;
    const editableColumns = columns.filter((column) => column !== primaryKey);
    const patch = Object.fromEntries(editableColumns.map((column) => [column, row[column]]));
    try {
      await updateTableRow(dbId, selectedTable, primaryKey, row[primaryKey], patch);
      toast({ title: 'Строка обновлена' });
    } catch (error: any) {
      toast({ title: 'Не удалось обновить строку', description: error.message, variant: 'destructive' });
    }
  };

  const submitTruncate = async () => {
    if (!canEdit || !selectedTable) return;
    setTruncating(true);
    try {
      await truncateDatabaseTable(dbId, selectedTable);
      toast({ title: 'Таблица очищена', description: `Все записи удалены из «${selectedTable}».` });
      setTruncateOpen(false);
      await loadRows(selectedTable);
      await loadTables();
    } catch (error: any) {
      toast({ title: 'Не удалось очистить таблицу', description: error.message, variant: 'destructive' });
    } finally {
      setTruncating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className="h-10 px-3 rounded-xl border border-border bg-card text-sm text-foreground min-w-[220px]">
          {tables.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => selectedTable && loadRows(selectedTable)}><RefreshCw className="w-4 h-4" /> Обновить</Button>
        {canEdit && selectedTable ? (
          <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setTruncateOpen(true)}>
            Очистить таблицу
          </Button>
        ) : null}
      </div>

      {canEdit && columns.length > 0 && (
        <div className="bg-card rounded-2xl border border-border shadow-card p-4 space-y-3">
          <h3 className="font-semibold text-foreground">Добавить строку</h3>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {columns.filter((column) => column !== primaryKey).map((column) => (
              <div key={column}>
                <Label>{column}</Label>
                <Input value={draft[column] ?? ''} onChange={(e) => setDraft((prev) => ({ ...prev, [column]: e.target.value }))} className="mt-1.5 rounded-xl" />
              </div>
            ))}
          </div>
          <Button variant="hero" size="sm" onClick={submitInsert}><Plus className="w-4 h-4" /> Добавить</Button>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border shadow-card overflow-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="border-b border-border bg-secondary/30">
            <tr>
              {columns.map((column) => <th key={column} className="text-left py-3 px-4 font-medium text-muted-foreground">{column}</th>)}
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx} className="border-b border-border/50"><td colSpan={columns.length + 1} className="py-3 px-4"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="py-8 px-4 text-center text-muted-foreground">Нет данных</td></tr>
            ) : rows.map((row, index) => (
              <tr key={`${row[primaryKey]}-${index}`} className="border-b border-border/50 align-top">
                {columns.map((column) => (
                  <td key={column} className="py-3 px-4">
                    {column === primaryKey ? (
                      <span className="font-mono text-xs">{String(row[column] ?? '')}</span>
                    ) : canEdit ? (
                      <Input
                        value={row[column] == null ? '' : String(row[column])}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRows((prev) => prev.map((item, idx) => idx === index ? { ...item, [column]: value } : item));
                        }}
                        className="h-9 rounded-lg"
                      />
                    ) : (
                      <span className="text-sm">{String(row[column] ?? '')}</span>
                    )}
                  </td>
                ))}
                <td className="py-3 px-4">
                  {canEdit ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => submitQuickEdit(row)}>Сохранить</Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteTarget(row)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Только просмотр</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={truncateOpen}
        title="Очистить всю таблицу?"
        description={`Будут удалены все строки в «${selectedTable}». Это действие нельзя отменить.`}
        confirmLabel={truncating ? 'Удаляем…' : 'Очистить'}
        destructive
        confirmDisabled={truncating}
        onConfirm={() => void submitTruncate()}
        onOpenChange={(open) => !open && !truncating && setTruncateOpen(false)}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить строку?"
        description="Это действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={submitDelete}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />
    </div>
  );
}

function SqlTab({ dbId, canEdit }: { dbId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('select now();');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ columns: string[]; rows: Record<string, any>[] } | null>(null);

  const run = async () => {
    if (!canEdit) return;
    setLoading(true);
    try {
      const data = await runQuery(dbId, query);
      setResult(data);
    } catch (error: any) {
      toast({ title: 'SQL ошибка', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border shadow-card p-4 space-y-3">
        {!canEdit ? (
          <p className="text-sm text-muted-foreground">Выполнять произвольный SQL могут участники с ролью редактор и выше.</p>
        ) : null}
        <Label>SQL запрос</Label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          readOnly={!canEdit}
          className="w-full min-h-[180px] rounded-2xl border border-border bg-card p-3 text-sm font-mono text-foreground disabled:opacity-70"
        />
        <Button variant="hero" onClick={run} disabled={loading || !canEdit}><Play className="w-4 h-4" /> {loading ? 'Выполняем...' : 'Выполнить'}</Button>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-card overflow-auto">
        {!result ? (
          <div className="p-8 text-center text-muted-foreground">Результат появится после выполнения запроса.</div>
        ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead className="border-b border-border bg-secondary/30">
              <tr>{result.columns.map((column) => <th key={column} className="text-left py-3 px-4 font-medium text-muted-foreground">{column}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr><td colSpan={Math.max(result.columns.length, 1)} className="py-8 px-4 text-center text-muted-foreground">Запрос выполнен, строк нет.</td></tr>
              ) : result.rows.map((row, index) => (
                <tr key={index} className="border-b border-border/50">
                  {result.columns.map((column) => <td key={column} className="py-3 px-4">{String(row[column] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const WIZARD_OP_LABELS: Record<WizardMigrationOpKind, string> = {
  add_column: 'Добавить колонку',
  drop_column: 'Удалить колонку',
  create_index: 'Создать индекс',
  rename_table: 'Переименовать таблицу',
  rename_column: 'Переименовать колонку',
};

function MigrationsTab({ dbId, dbEngine, canApplyMigration }: { dbId: string; dbEngine: DbEngine; canApplyMigration: boolean }) {
  const { toast } = useToast();
  const [list, setList] = useState<MigrationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [sqlManual, setSqlManual] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [schemaTables, setSchemaTables] = useState<SchemaTable[]>([]);
  const [opKind, setOpKind] = useState<WizardMigrationOpKind>('add_column');
  const [tableName, setTableName] = useState('');
  const [columnName, setColumnName] = useState('');
  const [colOptions, setColOptions] = useState<string[]>([]);
  const [newColumnName, setNewColumnName] = useState('');
  const [sqlType, setSqlType] = useState('VARCHAR(255)');
  const [colNullable, setColNullable] = useState(true);
  const [defaultExpr, setDefaultExpr] = useState('');
  const [indexName, setIndexName] = useState('');
  const [indexColumnsCsv, setIndexColumnsCsv] = useState('');
  const [indexUnique, setIndexUnique] = useState(false);
  const [renameTableFrom, setRenameTableFrom] = useState('');
  const [renameTableTo, setRenameTableTo] = useState('');
  const [renameColFrom, setRenameColFrom] = useState('');
  const [renameColTo, setRenameColTo] = useState('');

  const dialect = useMemo(() => detectSqlDialect(dbEngine), [dbEngine]);
  const typePresets = dialect === 'mysql' ? WIZARD_SQL_TYPES_MYSQL : WIZARD_SQL_TYPES_POSTGRES;

  const load = async () => {
    setLoading(true);
    try {
      setList(await fetchMigrations(dbId));
    } catch (error: any) {
      toast({ title: 'Не удалось загрузить миграции', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [dbId]);

  useEffect(() => {
    fetchSchema(dbId)
      .then(setSchemaTables)
      .catch(() => setSchemaTables([]));
  }, [dbId]);

  useEffect(() => {
    const needsCols = opKind === 'drop_column' || opKind === 'rename_column';
    if (!needsCols || !tableName.trim()) {
      setColOptions([]);
      setColumnName('');
      setRenameColFrom('');
      return;
    }
    fetchTableData(dbId, tableName, 1, 0)
      .then((r) => {
        setColOptions(r.columns);
        setColumnName((prev) => (prev && r.columns.includes(prev) ? prev : ''));
        setRenameColFrom((prev) => (prev && r.columns.includes(prev) ? prev : ''));
      })
      .catch(() => setColOptions([]));
  }, [dbId, tableName, opKind]);

  const wizardOp = useMemo((): WizardMigrationOp | null => {
    switch (opKind) {
      case 'add_column':
        if (!tableName.trim() || !newColumnName.trim() || !sqlType.trim()) return null;
        return {
          kind: 'add_column',
          table: tableName.trim(),
          column: newColumnName.trim(),
          sqlType,
          nullable: colNullable,
          defaultExpr: defaultExpr.trim() || undefined,
        };
      case 'drop_column':
        if (!tableName.trim() || !columnName.trim()) return null;
        return { kind: 'drop_column', table: tableName.trim(), column: columnName.trim() };
      case 'create_index':
        if (!tableName.trim() || !indexName.trim() || !indexColumnsCsv.trim()) return null;
        return {
          kind: 'create_index',
          table: tableName.trim(),
          indexName: indexName.trim(),
          columnsCsv: indexColumnsCsv,
          unique: indexUnique,
        };
      case 'rename_table':
        if (!renameTableFrom.trim() || !renameTableTo.trim()) return null;
        return { kind: 'rename_table', from: renameTableFrom.trim(), to: renameTableTo.trim() };
      case 'rename_column':
        if (!tableName.trim() || !renameColFrom.trim() || !renameColTo.trim()) return null;
        return {
          kind: 'rename_column',
          table: tableName.trim(),
          from: renameColFrom.trim(),
          to: renameColTo.trim(),
        };
    }
  }, [
    opKind,
    tableName,
    newColumnName,
    sqlType,
    colNullable,
    defaultExpr,
    columnName,
    indexName,
    indexColumnsCsv,
    indexUnique,
    renameTableFrom,
    renameTableTo,
    renameColFrom,
    renameColTo,
  ]);

  const wizardPreview = useMemo(() => {
    if (!wizardOp) return { sql: null as string | null, error: null as string | null };
    try {
      return { sql: buildWizardMigrationSql(dialect, wizardOp), error: null };
    } catch (e: any) {
      return { sql: null, error: e?.message ?? String(e) };
    }
  }, [dialect, wizardOp]);

  const defaultMigrationName = (suffix: string) =>
    name.trim() || `ui_${suffix}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  const submitManual = async () => {
    const trimmed = sqlManual.trim();
    if (!trimmed) {
      toast({ title: 'Введите SQL', variant: 'destructive' });
      return;
    }
    const migrationName = defaultMigrationName('manual');
    setSubmitting(true);
    try {
      await applyMigration(dbId, { name: migrationName, sql: trimmed });
      toast({ title: 'Миграция применена', description: migrationName });
      setSqlManual('');
      await load();
    } catch (error: any) {
      toast({ title: 'Миграция не выполнена', description: error.message, variant: 'destructive' });
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitWizard = async () => {
    if (!wizardPreview.sql) {
      toast({
        title: 'Мастер не готов',
        description: wizardPreview.error ?? 'Заполните поля',
        variant: 'destructive',
      });
      return;
    }
    const migrationName = defaultMigrationName(opKind);
    setSubmitting(true);
    try {
      await applyMigration(dbId, { name: migrationName, sql: wizardPreview.sql });
      toast({ title: 'Миграция применена', description: migrationName });
      await load();
    } catch (error: any) {
      toast({ title: 'Миграция не выполнена', description: error.message, variant: 'destructive' });
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const statusClass = (s: string) => {
    if (s === 'completed') return 'bg-success/15 text-success';
    if (s === 'failed') return 'bg-destructive/15 text-destructive';
    if (s === 'running') return 'bg-warning/15 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  const tableSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) =>
    schemaTables.length ? (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="rounded-xl font-mono text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {schemaTables.map((t) => (
            <SelectItem key={t.name} value={t.name} className="font-mono text-xs">
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="имя_таблицы"
        className="rounded-xl font-mono text-sm"
      />
    );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-card space-y-3">
        <div className="flex items-start gap-3">
          <GitBranch className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">Как это работает</p>
            <p>
              Основной способ — <strong>мастер</strong>: выбираете действие, заполняете поля, платформа собирает один SQL-запрос и выполняет его. Для сложных случаев откройте блок «Ручной SQL».
              Для MySQL в ручном режиме можно несколько выражений через «;». Для PostgreSQL удобнее одна команда за раз.
            </p>
            <p className="text-warning">Перед DDL на проде делайте бэкап на вкладке «Бэкапы».</p>
          </div>
        </div>
      </div>

      {!canApplyMigration ? (
        <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Применять миграции (мастер и ручной SQL) могут только <strong className="text-foreground">администраторы</strong> проекта. Ниже — история выполненных миграций (просмотр для всех участников).
          </p>
          <Button variant="outline" size="sm" className="shrink-0 rounded-xl" disabled={loading} onClick={() => void load()}>
            <RefreshCw className="w-4 h-4" /> Обновить список
          </Button>
        </div>
      ) : null}

      {canApplyMigration ? (
      <>
      <div className="bg-card rounded-2xl border border-border shadow-card p-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="migration-name">Название в истории (необязательно)</Label>
          <Input
            id="migration-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="например add_email_index — если пусто, имя сгенерируется"
            className="rounded-xl font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label>Действие</Label>
          <Select value={opKind} onValueChange={(v) => setOpKind(v as WizardMigrationOpKind)}>
            <SelectTrigger className="rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WIZARD_OP_LABELS) as WizardMigrationOpKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {WIZARD_OP_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {opKind === 'rename_table' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Таблица сейчас</Label>
              {tableSelect(renameTableFrom, setRenameTableFrom, 'старое имя')}
            </div>
            <div className="space-y-2">
              <Label>Новое имя таблицы</Label>
              <Input
                value={renameTableTo}
                onChange={(e) => setRenameTableTo(e.target.value)}
                placeholder="новое_имя"
                className="rounded-xl font-mono text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Таблица</Label>
            {tableSelect(tableName, setTableName, 'выберите таблицу')}
          </div>
        )}

        {opKind === 'add_column' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Имя новой колонки</Label>
              <Input
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="column_name"
                className="rounded-xl font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Тип SQL</Label>
              <Input
                list="wizard-sql-type-presets"
                value={sqlType}
                onChange={(e) => setSqlType(e.target.value)}
                className="rounded-xl font-mono text-sm"
              />
              <datalist id="wizard-sql-type-presets">
                {typePresets.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={colNullable} onCheckedChange={(c) => setColNullable(c === true)} />
              Разрешить NULL
            </label>
            <div className="space-y-2">
              <Label>Значение по умолчанию (необязательно)</Label>
              <Input
                value={defaultExpr}
                onChange={(e) => setDefaultExpr(e.target.value)}
                placeholder="напр. 0 или NULL или 'текст'"
                className="rounded-xl font-mono text-sm"
              />
            </div>
          </div>
        )}

        {opKind === 'drop_column' && (
          <div className="space-y-2">
            <Label>Колонка</Label>
            {colOptions.length ? (
              <Select value={columnName || undefined} onValueChange={setColumnName}>
                <SelectTrigger className="rounded-xl font-mono text-sm">
                  <SelectValue placeholder="колонка" />
                </SelectTrigger>
                <SelectContent>
                  {colOptions.map((c) => (
                    <SelectItem key={c} value={c} className="font-mono text-xs">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder="column_name"
                className="rounded-xl font-mono text-sm"
              />
            )}
          </div>
        )}

        {opKind === 'create_index' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Имя индекса</Label>
              <Input
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                placeholder="idx_users_email"
                className="rounded-xl font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Колонки через запятую</Label>
              <Input
                value={indexColumnsCsv}
                onChange={(e) => setIndexColumnsCsv(e.target.value)}
                placeholder="email, created_at"
                className="rounded-xl font-mono text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={indexUnique} onCheckedChange={(c) => setIndexUnique(c === true)} />
              Уникальный индекс
            </label>
          </div>
        )}

        {opKind === 'rename_column' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Старая колонка</Label>
              {colOptions.length ? (
                <Select value={renameColFrom || undefined} onValueChange={setRenameColFrom}>
                  <SelectTrigger className="rounded-xl font-mono text-sm">
                    <SelectValue placeholder="колонка" />
                  </SelectTrigger>
                  <SelectContent>
                    {colOptions.map((c) => (
                      <SelectItem key={c} value={c} className="font-mono text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={renameColFrom}
                  onChange={(e) => setRenameColFrom(e.target.value)}
                  className="rounded-xl font-mono text-sm"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Новое имя колонки</Label>
              <Input
                value={renameColTo}
                onChange={(e) => setRenameColTo(e.target.value)}
                placeholder="new_name"
                className="rounded-xl font-mono text-sm"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Предпросмотр SQL</Label>
          <Textarea
            readOnly
            value={wizardPreview.sql ?? ''}
            placeholder={
              wizardPreview.error
                ? wizardPreview.error
                : !wizardOp
                  ? 'Заполните поля выше — здесь появится готовый запрос'
                  : ''
            }
            className={`min-h-[88px] rounded-xl font-mono text-xs ${wizardPreview.error ? 'text-destructive border-destructive/40' : ''}`}
            spellCheck={false}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="hero" size="sm" disabled={submitting || !wizardPreview.sql} onClick={() => void submitWizard()}>
            <Play className="w-4 h-4" /> {submitting ? 'Выполняем…' : 'Применить из мастера'}
          </Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className="w-4 h-4" /> Обновить список
          </Button>
        </div>
      </div>

      <Collapsible className="rounded-2xl border border-border bg-card shadow-card">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary/40 rounded-2xl">
          Ручной SQL (продвинутый режим)
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4 pt-0 space-y-3">
          <Textarea
            value={sqlManual}
            onChange={(e) => setSqlManual(e.target.value)}
            placeholder={'-- Произвольный DDL/DML.\nCREATE INDEX IF NOT EXISTS idx_users_email ON users (email);'}
            className="min-h-[140px] rounded-xl font-mono text-xs"
            spellCheck={false}
          />
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => void submitManual()}>
            <Play className="w-4 h-4" /> Выполнить ручной SQL
          </Button>
        </CollapsibleContent>
      </Collapsible>
      </>
      ) : null}

      <div className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/30">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Дата</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Название</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Статус</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Лог</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td colSpan={4} className="py-3 px-4">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 px-4 text-center text-muted-foreground">
                  Миграций ещё не было
                </td>
              </tr>
            ) : (
              list.map((job) => (
                <tr key={job.id} className="border-b border-border/50 align-top">
                  <td className="py-3 px-4 whitespace-nowrap">{new Date(job.createdAt).toLocaleString()}</td>
                  <td className="py-3 px-4 font-mono text-xs">{job.name ?? '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(job.status)}`}>
                      {job.status === 'completed'
                        ? 'Успех'
                        : job.status === 'failed'
                          ? 'Ошибка'
                          : job.status === 'running'
                            ? 'В процессе'
                            : job.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words max-w-xl max-h-28 overflow-y-auto bg-secondary/20 rounded-lg p-2 border border-border/40">
                      {(job.logs ?? []).join('\n')}
                    </pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BackupsTab({
  dbId,
  dbName,
  dbEngine,
  canEdit,
  canAdmin,
}: {
  dbId: string;
  dbName: string;
  dbEngine: DbEngine;
  canEdit: boolean;
  canAdmin: boolean;
}) {
  const { toast } = useToast();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyBackupId, setBusyBackupId] = useState<string | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const runRestore = async (backupId: string) => {
    try {
      setBusyBackupId(backupId);
      await restoreBackup(dbId, backupId);
      toast({ title: 'Бэкап восстановлен', description: 'Данные в базе заменены содержимым снимка.' });
      await load();
    } catch (error: any) {
      toast({ title: 'Не удалось восстановить бэкап', description: error.message, variant: 'destructive' });
    } finally {
      setBusyBackupId(null);
      setRestoreConfirmId(null);
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

  const handleSqlDownload = async (backup: Backup, includeData: boolean) => {
    try {
      setBusyBackupId(backup.id);
      const tag = includeData ? 'data' : 'schema';
      await downloadBackupSql(dbId, backup.id, includeData, `${dbName}-${tag}-${backup.createdAt.slice(0, 10)}.sql`);
      toast({ title: includeData ? 'Скачан SQL с данными' : 'Скачан SQL (только схема)' });
    } catch (error: any) {
      toast({ title: 'Не удалось выгрузить SQL', description: error.message, variant: 'destructive' });
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
      setDeleteConfirmId(null);
    }
  };

  const sqlDumpAvailable = dbEngine !== 'MongoDB';

  return (
    <div className="space-y-4">
      <ConfirmModal
        open={restoreConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreConfirmId(null);
        }}
        title="Восстановить этот бэкап?"
        description="Восстановление приводит базу к состоянию выбранного снимка: таблицы и коллекции из бэкапа создаются при необходимости и заполняются данными; всё, чего нет в этом снимке (лишние таблицы / коллекции), удаляется. Исключение: служебная таблица _prisma_migrations не трогается. Для PostgreSQL и MySQL автоматически не восстанавливаются все вторичные индексы и часть ограничений — для них используйте SQL-дамп или миграции."
        confirmLabel="Восстановить"
        destructive
        onConfirm={() => restoreConfirmId && void runRestore(restoreConfirmId)}
      />

      <ConfirmModal
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
        title="Удалить этот бэкап?"
        description="Файл снимка будет удалён из хранилища МояБД. Восстановить его уже не получится."
        confirmLabel="Удалить"
        destructive
        confirmDisabled={busyBackupId !== null}
        onConfirm={() => deleteConfirmId && void runDeleteBackup(deleteConfirmId)}
      />

      <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <h4 className="font-medium text-foreground mb-2">Как работают бэкапы</h4>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
          <li>
            По кнопке «Создать бэкап» платформа подключается к вашей БД и собирает <strong>JSON-снимок</strong>: таблицы (или коллекции), структура колонок, все строки или документы, а также блок{' '}
            <code className="text-xs bg-secondary/50 px-1 rounded">logicalSchema</code> — логическая схема для диаграммы (таблицы, связи, расположение на холсте конструктора; для MongoDB — коллекции и индексы). Версия формата указана в{' '}
            <code className="text-xs bg-secondary/50 px-1 rounded">backupFormatVersion</code>.
          </li>
          <li>
            Файл сохраняется в хранилище приложения (запись в разделе «Бэкапы») и его можно <strong>скачать</strong> как .json для архива или переноса.
          </li>
          <li>
            <strong>Восстановление</strong> делает базу <strong>равной снимку</strong>: вернутся удалённые таблицы (PostgreSQL / MySQL), исчезнут те, которых не было в этом бэкапе; для <strong>MongoDB</strong> коллекции пересоздаются по списку из снимка (лишние удаляются), индексы из бэкапа накатываются заново.
          </li>
          <li>
            Для <strong>PostgreSQL и MySQL</strong> можно скачать <strong>SQL-дамп</strong> из сохранённого бэкапа: только схема (CREATE TABLE) или схема и строки (INSERT). Это отдельный файл .sql рядом с JSON.
          </li>
        </ul>
      </div>

      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">Снимки</h3>
          <p className="text-xs text-muted-foreground">JSON-снимок, восстановление и для SQL-баз — выгрузка .sql из бэкапа.</p>
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
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Дата</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Размер</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Тип</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Статус</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx} className="border-b border-border/50"><td colSpan={5} className="py-3 px-4"><Skeleton className="h-6 w-full" /></td></tr>
              ))
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
                    {sqlDumpAvailable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busyBackupId === backup.id}>
                            <FileCode className="w-4 h-4" /> SQL <ChevronDown className="w-4 h-4 opacity-70" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <DropdownMenuItem onClick={() => void handleSqlDownload(backup, false)}>Только схема (.sql)</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleSqlDownload(backup, true)}>Схема и данные (.sql)</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {canAdmin ? (
                      <Button variant="outline" size="sm" disabled={busyBackupId === backup.id} onClick={() => setRestoreConfirmId(backup.id)}><RotateCcw className="w-4 h-4" /> Восстановить</Button>
                    ) : null}
                    {canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={busyBackupId === backup.id}
                      onClick={() => setDeleteConfirmId(backup.id)}
                    >
                      <Trash2 className="w-4 h-4" /> Удалить
                    </Button>
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
