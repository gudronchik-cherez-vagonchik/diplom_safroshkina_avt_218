import fs from 'node:fs';
import path from 'node:path';

const rawName = process.argv[2];

if (!rawName) {
  console.error('Usage: npm run adapter:create -- <engine-name>');
  process.exit(1);
}

const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
if (!name) {
  console.error('Engine name is empty after normalization');
  process.exit(1);
}

const baseDir = path.resolve(process.cwd(), 'src', 'adapters', name);
if (fs.existsSync(baseDir)) {
  console.error(`Adapter directory already exists: ${baseDir}`);
  process.exit(1);
}

fs.mkdirSync(baseDir, { recursive: true });

const tsSafeName = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
const pascal = tsSafeName.charAt(0).toUpperCase() + tsSafeName.slice(1);

fs.writeFileSync(path.join(baseDir, 'index.ts'), `export const ${tsSafeName}Adapter = {
  engine: '${name}',
  title: '${pascal}',
  defaultPort: 0,
} as const;
`);

fs.writeFileSync(path.join(baseDir, `${name}.notes.md`), `# ${pascal} adapter

Checklist:
- connection pool
- testConnection
- listSchema
- constructor export/apply
- query runner
- backups
- migrations
`);

console.log(`Created adapter scaffold in ${baseDir}`);
