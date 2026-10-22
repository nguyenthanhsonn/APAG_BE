import { QueueModule } from '../../infrastructure/queue/queue.module';
import { Module } from '@nestjs/common';
import { StudentAccountMailService } from './student-account-mail.service';

@Module({
  imports: [QueueModule],
  providers: [StudentAccountMailService],
  exports: [StudentAccountMailService],
})
export class MailModule {}
