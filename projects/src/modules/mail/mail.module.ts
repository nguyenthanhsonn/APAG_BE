import { SmtpMailService } from './smtp-mail.service';
import { Module } from '@nestjs/common';
import { StudentAccountMailService } from './student-account-mail.service';

@Module({
  providers: [SmtpMailService, StudentAccountMailService],
  exports: [StudentAccountMailService],
})
export class MailModule {}
