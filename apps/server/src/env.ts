import "dotenv/config";

export interface EnvConfig {
  DATABASE_URL: string;
  REDIS_URL: string;
  SERVER_PORT: number;
  SERVER_HOST: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  CORS_ORIGIN: string;
  NODE_ENV: string;
}

export const env: EnvConfig = {
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://watchroom:watchroom@localhost:5432/watchroom",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  SERVER_PORT: parseInt(process.env.SERVER_PORT || "2261"),
  SERVER_HOST: process.env.SERVER_HOST || "0.0.0.0",
  SESSION_SECRET:
    process.env.SESSION_SECRET || "dev-session-secret-not-for-production",
  ENCRYPTION_KEY:
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:2262",
  NODE_ENV: process.env.NODE_ENV || "development",
};
