import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ZodExceptionFilter } from './common/zod-exception.filter';
import type { Request, Response, NextFunction } from 'express';

const PORT = parseInt(process.env.API_PORT ?? '4000', 10);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // QA-2: Zod schema failures are client errors (400), not 500s.
  app.useGlobalFilters(new ZodExceptionFilter());

  // cookie parsing (lightweight; avoids cookie-parser dep)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.cookie;
    if (header) {
      const jar: Record<string, string> = {};
      for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0) jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
      }
      (req as Request & { cookies: Record<string, string> }).cookies = jar;
    }
    next();
  });

  // CORS: the web BFF proxies server-to-server, but direct browser calls during
  // local dev need credentials.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',');
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.setGlobalPrefix('/', { exclude: ['healthz'] });

  app.getHttpAdapter().get('/healthz', (_req: unknown, res: unknown) => {
    (res as { status: (n: number) => { json: (b: unknown) => void } }).status(200).json({ ok: true });
  });

  await app.listen(PORT, '0.0.0.0');
  console.log(`open-triage api listening on :${PORT}`);
}

void bootstrap();
