import { RedisModule } from './infrastructure/cache/redis.module';
import { ObservabilityModule } from './observability/observability.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { AppController } from './app.controller';
import appConfig from './config/app.config';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AdminClassesModule } from './modules/admin-classes/admin-classes.module';
import { AdminFacultiesModule } from './modules/admin-faculties/admin-faculties.module';
import { AdminMajorsModule } from './modules/admin-majors/admin-majors.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AuthModule } from './modules/auth/auth.module';
import { EvidencesModule } from './modules/evidences/evidences.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PostsModule } from './modules/posts/posts.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { StudentsModule } from './modules/students/students.module';
import { TrainingEvaluationsModule } from './modules/training-evaluations/training-evaluations.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [join(__dirname, '..', '.env')],
      isGlobal: true,
      cache: true,
      load: [appConfig],
      validate: validateEnvironment,
    }),
    ObservabilityModule,
    RedisModule,
    PrismaModule,
    AdminClassesModule,
    AdminFacultiesModule,
    AdminMajorsModule,
    AdminUsersModule,
    AuthModule,
    UsersModule,
    StudentsModule,
    TrainingEvaluationsModule,
    EvidencesModule,
    NotificationsModule,
    MetadataModule,
    ReportsModule,
    SemestersModule,
    PostsModule,
    ProfileModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
