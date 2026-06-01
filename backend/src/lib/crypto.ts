const SECRET = process.env.JWT_SECRET ?? 'change_me';

export function encryptSecret(value: string): string {
  return Buffer.from(`${SECRET}:${value}`, 'utf8').toString('base64');
}

export function decryptSecret(value: string): string {
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const prefix = `${SECRET}:`;
  if (!decoded.startsWith(prefix)) {
    throw new Error('Неверный формат сохранённого секрета');
  }
  return decoded.slice(prefix.length);
}

export function maskConnectionString(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}
