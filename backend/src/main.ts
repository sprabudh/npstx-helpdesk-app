import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { env } from './common/env';
import { GlobalExceptionFilter } from './common/http-exception.filter';
import { JsonLogger } from './common/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: env.corsOrigin.split(','), credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('NPSTX Integrated Helpdesk API')
      .setDescription('HR, L&D, IT and Support, Admin Desk and Salesforce helpdesks. See docs/Helpdesk_SDD_v1.0.md section 9.')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  await app.listen(env.port, '0.0.0.0');
  new JsonLogger('Bootstrap').log(`API on :${env.port} (auth=${env.authMode}, ai=${env.ai.provider})`);
}
void bootstrap();
