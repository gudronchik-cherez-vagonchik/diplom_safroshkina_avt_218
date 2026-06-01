export type SupportedEngine = 'postgres' | 'mysql' | 'mongodb';

export type ConnectionInput = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
};

export interface DatabaseAdapterModule {
  engine: SupportedEngine;
  title: string;
  defaultPort: number;
}
