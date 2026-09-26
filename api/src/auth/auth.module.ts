import { Module } from '@nestjs/common';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { SessionGuard, TenantRoleGuard, PlatformAdminGuard } from './guards';
import { ProducerModule } from '../worker/producer.module';

@Module({
  imports: [ProducerModule],
  controllers: [AuthController, PasswordResetController],
  providers: [AuthService, PasswordResetService, PrismaService, SessionGuard, TenantRoleGuard, PlatformAdminGuard],
  exports: [SessionGuard, TenantRoleGuard, PlatformAdminGuard, PrismaService],
})
export class AuthModule {}
