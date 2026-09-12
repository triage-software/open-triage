import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma service. ADR-0001: tenant scoping is enforced at the service layer —
 * every tenant-model query must carry a tenantId filter. Guards
 * (SessionGuard/TenantRoleGuard/PlatformAdminGuard) resolve tenant context
 * before any query runs; cross-tenant queries are allowed only inside
 * PlatformAdminModule code paths.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
