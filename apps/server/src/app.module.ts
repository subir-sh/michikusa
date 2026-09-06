import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { PhotoModule } from './photo/photo.module';
import { PlaceModule } from './place/place.module';
import { VisitModule } from './visit/visit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const database = resolve(
          process.cwd(),
          config.get<string>('DATABASE_PATH') ?? '../../data/michikusa.db',
        );

        mkdirSync(dirname(database), { recursive: true });

        return {
          type: 'better-sqlite3' as const,
          database,
          autoLoadEntities: true,
          synchronize: true,
        };
      },
    }),
    PhotoModule,
    PlaceModule,
    VisitModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
