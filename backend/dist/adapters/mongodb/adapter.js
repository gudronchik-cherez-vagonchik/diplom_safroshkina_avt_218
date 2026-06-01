import { MongoClient, ObjectId } from 'mongodb';
function encode(value) {
    return encodeURIComponent(value);
}
export function buildConnectionString(input, authSource) {
    const auth = input.user ? `${encode(input.user)}:${encode(input.password)}@` : '';
    const params = new URLSearchParams();
    params.set('authSource', authSource || input.database || 'admin');
    if (input.ssl)
        params.set('tls', 'true');
    return `mongodb://${auth}${input.host}:${input.port}/${input.database}?${params.toString()}`;
}
async function withClient(input, fn, authSource) {
    const client = new MongoClient(buildConnectionString(input, authSource), { connectTimeoutMS: 5000 });
    try {
        await client.connect();
        return await fn(client);
    }
    finally {
        await client.close();
    }
}
function normalizeValue(value) {
    if (value instanceof ObjectId)
        return value.toHexString();
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map(normalizeValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]));
    }
    return value;
}
function parseId(value) {
    if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))
        return new ObjectId(value);
    return value;
}
function typeOfValue(value) {
    if (value === null)
        return 'null';
    if (value instanceof ObjectId)
        return 'ObjectId';
    if (value instanceof Date)
        return 'date';
    if (Array.isArray(value)) {
        const inner = value.length ? typeOfValue(value[0]) : 'mixed';
        return `array<${inner}>`;
    }
    if (typeof value === 'object')
        return 'object';
    return typeof value;
}
function collectFieldStats(doc, path = '', target = new Map()) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc))
        return target;
    for (const [key, value] of Object.entries(doc)) {
        const nextPath = path ? `${path}.${key}` : key;
        const entry = target.get(nextPath) ?? { count: 0, types: new Set() };
        entry.count += 1;
        entry.types.add(typeOfValue(value));
        target.set(nextPath, entry);
        if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId)) {
            collectFieldStats(value, nextPath, target);
        }
    }
    return target;
}
function buildTree(stats, sampleSize) {
    const root = {};
    for (const [path, meta] of stats.entries()) {
        const parts = path.split('.');
        let node = root;
        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i];
            node[part] ||= { __children: {} };
            if (i === parts.length - 1) {
                node[part].__meta = meta;
            }
            node = node[part].__children;
        }
    }
    const walk = (obj) => Object.entries(obj).map(([name, value]) => ({
        name,
        types: [...(value.__meta?.types ?? new Set(['object']))],
        required: (value.__meta?.count ?? 0) === sampleSize,
        frequency: sampleSize === 0 ? 0 : Number(((value.__meta?.count ?? 0) / sampleSize).toFixed(2)),
        children: Object.keys(value.__children).length ? walk(value.__children) : undefined,
    }));
    return walk(root);
}
export async function testMongoConnection(connection) {
    return withClient(connection, async (client) => {
        await client.db(connection.database).command({ ping: 1 });
        const buildInfo = await client.db('admin').command({ buildInfo: 1 });
        return { version: String(buildInfo.version ?? 'MongoDB') };
    }, connection.database || 'admin');
}
export async function provisionMongoDatabase(input) {
    return withClient(input.admin, async (client) => {
        const targetDb = client.db(input.databaseName);
        const existingUsers = await targetDb.command({ usersInfo: 1 }).catch(() => ({ users: [] }));
        const exists = (existingUsers.users ?? []).some((user) => user.user === input.ownerUser);
        if (exists) {
            await targetDb.command({
                updateUser: input.ownerUser,
                pwd: input.ownerPassword,
                roles: [
                    { role: 'dbOwner', db: input.databaseName },
                    { role: 'readWrite', db: input.databaseName },
                ],
            });
        }
        else {
            await targetDb.command({
                createUser: input.ownerUser,
                pwd: input.ownerPassword,
                roles: [
                    { role: 'dbOwner', db: input.databaseName },
                    { role: 'readWrite', db: input.databaseName },
                ],
            });
        }
        const collections = await targetDb.listCollections({}, { nameOnly: true }).toArray();
        if (!collections.some((collection) => collection.name === '__dataisland_init__')) {
            await targetDb.createCollection('__dataisland_init__');
            await targetDb.collection('__dataisland_init__').insertOne({ createdAt: new Date() });
        }
    }, input.admin.database || 'admin');
}
export async function dropMongoManagedDatabase(admin, databaseName) {
    return withClient(admin, async (client) => {
        await client.db(databaseName).dropDatabase();
    }, admin.database || 'admin');
}
export async function listMongoCollections(connection) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const dbStats = await db.stats();
        const collections = await db.listCollections({}, { nameOnly: false }).toArray();
        const rows = [];
        for (const collection of collections) {
            const name = collection.name;
            if (name.startsWith('system.'))
                continue;
            const docCount = await db.collection(name).estimatedDocumentCount();
            const stats = await db.command({ collStats: name }).catch(() => null);
            rows.push({
                name,
                columns: 0,
                rows: docCount,
                size: `${Math.round(Number(stats?.size ?? 0) / 1024)} KB`,
            });
        }
        return rows;
    }, connection.database);
}
export async function getMongoCollectionData(connection, collection, limit, offset) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const docs = await db.collection(collection).find({}).skip(offset).limit(limit).toArray();
        const rows = docs.map((doc) => normalizeValue(doc));
        const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
        return { columns, rows };
    }, connection.database);
}
export async function insertMongoDocument(connection, collection, data) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const payload = { ...data };
        delete payload._id;
        const result = await db.collection(collection).insertOne(payload);
        return { _id: result.insertedId.toHexString(), ...normalizeValue(payload) };
    }, connection.database);
}
export async function updateMongoDocument(connection, collection, pkValue, patch) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const payload = { ...patch };
        delete payload._id;
        const _id = parseId(pkValue);
        await db.collection(collection).updateOne({ _id }, { $set: payload });
        const next = await db.collection(collection).findOne({ _id });
        return next ? normalizeValue(next) : null;
    }, connection.database);
}
export async function deleteMongoDocument(connection, collection, pkValue) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const _id = parseId(pkValue);
        const result = await db.collection(collection).deleteOne({ _id });
        return result.deletedCount ?? 0;
    }, connection.database);
}
export async function clearMongoCollection(connection, collection) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const result = await db.collection(collection).deleteMany({});
        return { deleted: Number(result.deletedCount ?? 0) };
    }, connection.database);
}
export async function createMongoCollection(connection, name) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
        if (!existing.length)
            await db.createCollection(name);
        return { created: true };
    }, connection.database);
}
export async function deleteMongoCollection(connection, name) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        await db.collection(name).drop().catch(() => undefined);
        return { deleted: true };
    }, connection.database);
}
export async function getMongoVisual(connection) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const collections = await db.listCollections({}, { nameOnly: false }).toArray();
        const visualCollections = [];
        const references = [];
        const knownNames = new Set(collections.map((c) => c.name));
        for (const collection of collections) {
            if (collection.name.startsWith('system.'))
                continue;
            const coll = db.collection(collection.name);
            const docs = await coll.find({}).limit(50).toArray();
            const stats = await db.command({ collStats: collection.name }).catch(() => ({}));
            const indexes = await coll.indexes().catch(() => []);
            const statsMap = docs.reduce((acc, doc) => collectFieldStats(doc, '', acc), new Map());
            const fields = buildTree(statsMap, docs.length);
            const inferred = [];
            for (const [path, meta] of statsMap.entries()) {
                const fieldName = path.split('.').at(-1) || path;
                const base = fieldName.replace(/Id$/i, '').replace(/^_/, '');
                const candidates = [base, `${base}s`, `${base}es`, base.toLowerCase(), `${base.toLowerCase()}s`].filter(Boolean);
                const target = candidates.find((candidate) => knownNames.has(candidate));
                if (target && /id$/i.test(fieldName)) {
                    inferred.push({ fromCollection: collection.name, field: path, toCollection: target, kind: 'inferred' });
                }
            }
            references.push(...inferred);
            visualCollections.push({
                name: collection.name,
                documents: await coll.estimatedDocumentCount(),
                sizeBytes: Number(stats.size ?? 0),
                validation: collection.options?.validator ?? null,
                indexes: indexes.map((index) => ({ name: index.name, key: index.key, unique: !!index.unique, sparse: !!index.sparse, expireAfterSeconds: index.expireAfterSeconds ?? null })),
                fields,
            });
        }
        return { collections: visualCollections, references };
    }, connection.database);
}
export async function exportMongoBackupPayload(connection) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        const payload = { collections: [] };
        for (const { name } of collections) {
            if (name.startsWith('system.'))
                continue;
            const docs = await db.collection(name).find({}).toArray();
            const indexes = await db.collection(name).indexes().catch(() => []);
            payload.collections.push({ name, documents: docs.map(normalizeValue), indexes });
        }
        return payload;
    }, connection.database);
}
export async function restoreMongoBackupPayload(connection, payload) {
    return withClient(connection, async (client) => {
        const db = client.db(connection.database);
        const existing = await db.listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of existing) {
            if (!name.startsWith('system.'))
                await db.collection(name).drop().catch(() => undefined);
        }
        for (const collection of payload.collections ?? []) {
            await db.createCollection(collection.name).catch(() => undefined);
            const coll = db.collection(collection.name);
            const docs = (collection.documents ?? []).map((doc) => {
                const next = { ...doc };
                if (typeof next._id === 'string' && /^[a-f0-9]{24}$/i.test(next._id))
                    next._id = new ObjectId(next._id);
                return next;
            });
            if (docs.length) {
                await coll.insertMany(docs);
            }
            for (const spec of collection.indexes ?? []) {
                const name = String(spec?.name ?? '');
                if (!name || name === '_id_')
                    continue;
                try {
                    const key = spec.key && typeof spec.key === 'object' ? spec.key : {};
                    const opts = { name };
                    if (spec.unique)
                        opts.unique = true;
                    if (spec.sparse)
                        opts.sparse = true;
                    if (spec.expireAfterSeconds != null)
                        opts.expireAfterSeconds = spec.expireAfterSeconds;
                    await coll.createIndex(key, opts);
                }
                catch {
                    /* дубликат имени индекса и т.п. */
                }
            }
        }
    }, connection.database);
}
