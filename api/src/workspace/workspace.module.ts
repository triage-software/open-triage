import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
