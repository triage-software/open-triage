import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { SessionGuard, TenantRoleGuard, PlatformAdminGuard } from './guards';
import { ProducerModule } from '../worker/producer.module';

@Module({
  imports: [ProducerModule],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, SessionGuard, TenantRoleGuard, PlatformAdminGuard],
  exports: [SessionGuard, TenantRoleGuard, PlatformAdminGuard, PrismaService],
})
export class AuthModule {}
