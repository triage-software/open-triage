import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { ProducerModule } from '../worker/producer.module';

@Module({
  imports: [AuthModule, ProducerModule],
  controllers: [UsersController],
})
export class UsersModule {}