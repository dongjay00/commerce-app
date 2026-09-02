import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorRegistry } from './shared/infrastructure/http/domain-error.registry';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainExceptionFilter(app.get(DomainErrorRegistry)));
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
