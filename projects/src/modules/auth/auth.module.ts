import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenStoreService } from './jwt/auth-token-store';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('app.jwtAccessSecret'),
        signOptions: {
          expiresIn: configService.get<string>(
            'app.jwtAccessExpiresIn',
            '15m',
          ) as never,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenStoreService, JwtStrategy],
  exports: [AuthService, AuthTokenStoreService],
})
export class AuthModule {}
