function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined
}

export interface Config {
  nodeEnv: string
  port: number
  databaseUrl: string
  sessionSecret: string
  appOrigin: string
  bootstrapAdminEmail: string | undefined
  mail: { apiKey: string | undefined; from: string }
  storage: {
    endpoint: string | undefined
    bucket: string | undefined
    accessKeyId: string | undefined
    secretAccessKey: string | undefined
  }
}

export function loadConfig(): Config {
  const sessionSecret = required('SESSION_SECRET')
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret,
    appOrigin: required('APP_ORIGIN'),
    bootstrapAdminEmail: optional('BOOTSTRAP_ADMIN_EMAIL'),
    mail: { apiKey: optional('RESEND_API_KEY'), from: process.env.MAIL_FROM ?? 'Tennis Team <noreply@localhost>' },
    storage: {
      endpoint: optional('STORAGE_ENDPOINT'),
      bucket: optional('STORAGE_BUCKET'),
      accessKeyId: optional('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: optional('STORAGE_SECRET_ACCESS_KEY'),
    },
  }
}
