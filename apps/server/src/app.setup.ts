import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@skill-hub/shared';
import cookieParser from 'cookie-parser';

// main.ts 与 e2e 测试共用，保证测试打到的应用与线上配置一致。
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
      // 统一返回第一条校验错误的文案，前端直接展示
      exceptionFactory: (errors) => {
        const first = errors[0];
        const message = first?.constraints ? Object.values(first.constraints)[0] : '请求参数不合法';
        return new BadRequestException(message);
      },
    }),
  );
  app.enableShutdownHooks();
  return app;
}
