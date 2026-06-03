import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

// `sku` is immutable and `stock` is changed only via POST /:id/adjust-stock —
// both are omitted so the global ValidationPipe (forbidNonWhitelisted) rejects
// any attempt to PATCH them.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['sku', 'stock'] as const),
) {}
