# DataIsland frontend -> backend

## Backend
Run the backend on:
- http://localhost:4000

## Frontend env
Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

## What was wired
- auth/login/register/me
- projects list/detail
- databases list/detail
- schema tab
- data tab
- SQL tab
- backups tab
- dashboard database list
- project detail database list

## Notes
- frontend still keeps some UI-only screens such as visual migration wizard and some modals
- create database modal on `/databases` is still UI-only and is not yet bound to `/databases/postgres/register` or `/databases/postgres/provision`
- constructor tab UI remains local; schema/data/sql/backups are connected to backend
