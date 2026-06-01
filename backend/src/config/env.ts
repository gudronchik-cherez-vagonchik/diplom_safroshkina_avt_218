
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(8),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:8080,http://localhost:5173'),
  PLATFORM_PG_HOST: z.string().default('127.0.0.1'),
  PLATFORM_PG_PORT: z.coerce.number().int().positive().default(5432),
  PLATFORM_PG_DATABASE: z.string().default('postgres'),
  PLATFORM_PG_USER: z.string().default('postgres'),
  PLATFORM_PG_PASSWORD: z.string().default('postgres'),
  PLATFORM_PG_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
  PLATFORM_PG_PUBLIC_HOST: z.string().optional(),
  PLATFORM_PG_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  PLATFORM_PG_PUBLIC_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
  PLATFORM_MONGO_HOST: z.string().default('127.0.0.1'),
  PLATFORM_MONGO_PORT: z.coerce.number().int().positive().default(27017),
  PLATFORM_MONGO_DATABASE: z.string().default('admin'),
  PLATFORM_MONGO_USER: z.string().default('root'),
  PLATFORM_MONGO_PASSWORD: z.string().default('root'),
  PLATFORM_MONGO_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
  PLATFORM_MONGO_PUBLIC_HOST: z.string().optional(),
  PLATFORM_MONGO_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  PLATFORM_MONGO_PUBLIC_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
  PLATFORM_MYSQL_HOST: z.string().default('127.0.0.1'),
  PLATFORM_MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  PLATFORM_MYSQL_DATABASE: z.string().default('mysql'),
  PLATFORM_MYSQL_USER: z.string().default('root'),
  PLATFORM_MYSQL_PASSWORD: z.string().default('root'),
  PLATFORM_MYSQL_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
  PLATFORM_MYSQL_PUBLIC_HOST: z.string().optional(),
  PLATFORM_MYSQL_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  PLATFORM_MYSQL_PUBLIC_SSL: z.union([z.string(), z.boolean()]).optional().default('false'),
});

function asBool(value: string | boolean | undefined) {
  return String(value).toLowerCase() === 'true';
}

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

export const platformPgConfig = {
  host: env.PLATFORM_PG_HOST,
  port: env.PLATFORM_PG_PORT,
  database: env.PLATFORM_PG_DATABASE,
  user: env.PLATFORM_PG_USER,
  password: env.PLATFORM_PG_PASSWORD,
  ssl: asBool(env.PLATFORM_PG_SSL),
};

export const platformPgPublicConfig = {
  host: env.PLATFORM_PG_PUBLIC_HOST || env.PLATFORM_PG_HOST,
  port: env.PLATFORM_PG_PUBLIC_PORT || env.PLATFORM_PG_PORT,
  ssl: asBool(env.PLATFORM_PG_PUBLIC_SSL),
};

export const platformMongoConfig = {
  host: env.PLATFORM_MONGO_HOST,
  port: env.PLATFORM_MONGO_PORT,
  database: env.PLATFORM_MONGO_DATABASE,
  user: env.PLATFORM_MONGO_USER,
  password: env.PLATFORM_MONGO_PASSWORD,
  ssl: asBool(env.PLATFORM_MONGO_SSL),
};

export const platformMongoPublicConfig = {
  host: env.PLATFORM_MONGO_PUBLIC_HOST || env.PLATFORM_MONGO_HOST,
  port: env.PLATFORM_MONGO_PUBLIC_PORT || env.PLATFORM_MONGO_PORT,
  ssl: asBool(env.PLATFORM_MONGO_PUBLIC_SSL),
};

export const platformMysqlConfig = {
  host: env.PLATFORM_MYSQL_HOST,
  port: env.PLATFORM_MYSQL_PORT,
  database: env.PLATFORM_MYSQL_DATABASE,
  user: env.PLATFORM_MYSQL_USER,
  password: env.PLATFORM_MYSQL_PASSWORD,
  ssl: asBool(env.PLATFORM_MYSQL_SSL),
};

export const platformMysqlPublicConfig = {
  host: env.PLATFORM_MYSQL_PUBLIC_HOST || env.PLATFORM_MYSQL_HOST,
  port: env.PLATFORM_MYSQL_PUBLIC_PORT || env.PLATFORM_MYSQL_PORT,
  ssl: asBool(env.PLATFORM_MYSQL_PUBLIC_SSL),
};
