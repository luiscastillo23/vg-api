import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

export const ApiPaginated = <TModel extends Type<any>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          meta: {
            type: 'object',
            required: ['total', 'page', 'limit', 'pages', 'hasNext'],
            properties: {
              total: { type: 'integer', example: 137 },
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              pages: { type: 'integer', example: 7 },
              hasNext: { type: 'boolean', example: true },
            },
          },
        },
      },
    }),
  );
