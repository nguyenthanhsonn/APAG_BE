import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EvaluationFinalizeService } from './application/evaluation-finalize.service';
import { EvaluationQueryService } from './application/evaluation-query.service';
import { EvaluationReviewService } from './application/evaluation-review.service';
import { EvaluationScoreService } from './application/evaluation-score.service';
import { EvaluationSubmitService } from './application/evaluation-submit.service';
import { AdminTrainingEvaluationsController } from './presentation/admin-training-evaluations.controller';
import { TrainingEvaluationsController } from './presentation/training-evaluations.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [
    TrainingEvaluationsController,
    AdminTrainingEvaluationsController,
  ],
  // Luồng phụ thuộc một chiều: review dùng score/finalize; các use case dùng query để tra phân công.
  // Các application service truy cập Prisma trực tiếp, không thêm repository trung gian.
  providers: [
    EvaluationQueryService,
    EvaluationScoreService,
    EvaluationSubmitService,
    EvaluationReviewService,
    EvaluationFinalizeService,
  ],
})
export class TrainingEvaluationsModule {}
