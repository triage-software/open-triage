import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
