import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SubcategoriesController } from './subcategories.controller';
import { SubcategoriesService } from './subcategories.service';
import { SubcategoriesRepository } from './subcategories.repository';

@Module({
  imports: [PrismaModule],
  controllers: [SubcategoriesController],
  providers: [SubcategoriesService, SubcategoriesRepository],
  exports: [SubcategoriesService],
})
export class SubcategoriesModule {}
