import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServicesRepository } from './services.repository';

@Module({
  imports: [PrismaModule],
  controllers: [ServicesController],
  providers: [ServicesService, ServicesRepository],
  exports: [ServicesService],
})
export class ServicesModule {}
