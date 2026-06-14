import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { UsersRepository } from './users.repository';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { UserModel } from '../../../generated/prisma/models/User';

export function makeETag(updatedAt: Date): string {
  return `W/"${updatedAt.getTime().toString(16)}"`;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Emit after a Clerk user.created webhook transaction commits — never call inside a transaction. */
  emitCreated(user: UserModel): void {
    this.eventEmitter.emit('user.created', { userId: user.id, email: user.email, role: user.role });
    this.logger.debug(`user.created emitted for ${user.id}`);
    this.logger.debug(`Clerk ID for new user: ${user.clerkId}`);
  }

  findAll(query: UserQueryDto) {
    return this.usersRepo.findAll(
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
      query.role,
      query.status,
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );
  }

  async findOne(id: string): Promise<UserModel> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserModel> {
    await this.findOne(id);
    try {
      return await this.usersRepo.update(id, dto);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Clerk ID or email already in use');
      }
      throw err;
    }
  }

  async updateRole(id: string, dto: UpdateRoleDto, ifMatch?: string): Promise<UserModel> {
    const user = await this.findOne(id);
    if (ifMatch && ifMatch !== '*' && ifMatch !== makeETag(user.updatedAt)) {
      throw new HttpException('Precondition Failed', HttpStatus.PRECONDITION_FAILED);
    }
    return this.usersRepo.update(id, { role: dto.role });
  }

  async updateStatus(id: string, dto: UpdateStatusDto): Promise<UserModel> {
    await this.findOne(id);
    return this.usersRepo.update(id, { status: dto.status });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.usersRepo.delete(id);
  }

  async getStats(id: string) {
    await this.findOne(id);
    return this.usersRepo.getStats(id);
  }

  async getActivity(id: string, pagination: PaginationDto) {
    await this.findOne(id);
    return this.usersRepo.getActivity(id, pagination.page ?? 1, pagination.limit ?? 20);
  }
}
