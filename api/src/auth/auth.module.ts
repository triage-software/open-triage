import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { SessionGuard, TenantRoleGuard, PlatformAdminGuard } from './guards';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService, SessionGuard, TenantRoleGuard, PlatformAdminGuard],
  exports: [SessionGuard, TenantRoleGuard, PlatformAdminGuard, PrismaService],
})
export class AuthModule {}
