import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { FastifyReply } from 'fastify';
import { UsersService, makeETag } from './users.service';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../../generated/prisma/enums';

const toDto = (user: unknown) =>
  plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });

@ApiTags('users')
@ApiBearerAuth('clerk')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Paginated list of users with role/status filters' })
  @ApiResponse({ status: 200, description: 'Paginated users list' })
  async findAll(@Query() query: UserQueryDto) {
    const result = await this.usersService.findAll(query);
    return { ...result, items: result.items.map(toDto) };
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.usersService.findOne(id);
    reply.header('ETag', makeETag(user.updatedAt));
    return toDto(user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update user profile fields' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Clerk ID or email already in use' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return toDto(await this.usersService.update(id, dto));
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Change user role — requires If-Match for optimistic concurrency' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiHeader({ name: 'If-Match', description: 'ETag from GET /:id — send * to skip check', required: false })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 412, description: 'ETag mismatch — fetch the latest version and retry' })
  async updateRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.usersService.updateRole(id, dto, ifMatch);
    reply.header('ETag', makeETag(user.updatedAt));
    return toDto(user);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update user status (activate, suspend, etc.)' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return toDto(await this.usersService.updateStatus(id, dto));
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/stats')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Aggregated stats: order count, review count, balance' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, description: 'User stats' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getStats(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.getStats(id);
  }

  @Get(':id/activity')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Paginated activity log for a user' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, description: 'Paginated activity log' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.usersService.getActivity(id, pagination);
  }
}
