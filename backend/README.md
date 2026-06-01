# DataIsland Backend

Нормальный backend под ваш фронт, а не моковый пример.

## Что уже есть

- авторизация и регистрация через JWT
- projects API
- databases API
- реальное подключение к удалённой PostgreSQL
- создание новой PostgreSQL базы через admin connection
- schema explorer
- constructor export/apply
- data CRUD
- SQL editor
- backups (JSON snapshot)
- migrations (raw SQL)
- audit log
- team list
- billing plans (демо-тарифы)

## Стек

- Fastify
- TypeScript
- Prisma
- SQLite для control-plane
- PostgreSQL adapter для управляемых БД

## Структура

```txt
src/
  adapters/postgres/
  config/
  lib/
  modules/
    auth/
    projects/
    databases/
    backups/
    migrations/
    audit/
    team/
    billing/
    health/
  app.ts
  server.ts
prisma/
  schema.prisma
  seed.ts
```

## Быстрый запуск

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed
npm run dev
```

Backend по умолчанию поднимется на `http://localhost:4000`.

## Seed-пользователь

```txt
email: alex@dataisland.local
password: admin123
```

## Основные endpoint'ы

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### Projects
- `GET /projects`
- `POST /projects`

### Databases
- `GET /databases`
- `GET /databases/:id`
- `POST /databases/postgres/register`
- `POST /databases/postgres/provision`
- `GET /databases/:id/schema`
- `GET /databases/:id/constructor`
- `POST /databases/:id/constructor/apply`
- `GET /databases/:id/data/:table?limit=50&offset=0`
- `POST /databases/:id/query`
- `POST /databases/:id/tables/:table/rows`
- `PATCH /databases/:id/tables/:table/rows`
- `DELETE /databases/:id/tables/:table/rows`

### Backups
- `GET /databases/:id/backups`
- `POST /databases/:id/backups`
- `POST /databases/:id/backups/:backupId/restore`

### Migrations
- `GET /databases/:id/migrations`
- `POST /databases/:id/migrations`

### Service pages from frontend
- `GET /audit`
- `GET /team`
- `GET /billing/plans`

## Что нужно поменять во фронте

### 1. заменить моковый `src/services/api.ts`
Для этого я добавил файл `frontend-api-replacement.ts` рядом в корне артефакта.

### 2. поправить `DatabaseDetail.tsx`
Сейчас `runQuery(query)` не принимает `dbId`. Нужно вызвать `runQuery(id, query)`.

### 3. auth token
После login/register фронт должен сохранять JWT, а не только объект пользователя.

## Важные ограничения текущей версии

- пока поддерживается только PostgreSQL как реально рабочий engine
- backups пока JSON-based, не `pg_dump`
- migration postgres -> mysql пока не реализована
- MySQL adapter пока не добавлен
- secrets сейчас зашифрованы упрощённо; для production нужен нормальный KMS/crypto layer

## Что я бы делал следующим коммитом

- MySQL adapter
- refresh token flow
- role-based permissions
- pg_dump backups
- queue для долгих операций
- websocket/progress updates для migration и backup jobs
