import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountRepository } from './account.repository';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from '../users/dto/address.dto';
import { UpdatePreferencesDto } from '../users/dto/update-preferences.dto';
import type { AppUser } from '../../common/decorators/current-user.decorator';
import type { UserModel } from '../../../generated/prisma/models/User';
import type { AddressModel } from '../../../generated/prisma/models/Address';
import type { UserPreferencesModel } from '../../../generated/prisma/models/UserPreferences';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly prisma: PrismaService,
  ) {}

  private require(user: AppUser | undefined): AppUser {
    if (!user) throw new NotFoundException('User profile not found');
    return user;
  }

  getMe(user: AppUser | undefined): AppUser {
    return this.require(user);
  }

  async updateMe(user: AppUser | undefined, dto: UpdateProfileDto): Promise<UserModel> {
    const { id } = this.require(user);
    try {
      return await this.accountRepo.updateProfile(id, dto);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Profile update conflict');
      }
      throw err;
    }
  }

  listAddresses(user: AppUser | undefined): Promise<AddressModel[]> {
    const { id } = this.require(user);
    return this.accountRepo.findAddresses(id);
  }

  async getAddress(user: AppUser | undefined, addressId: string): Promise<AddressModel> {
    const { id } = this.require(user);
    const address = await this.accountRepo.findAddress(addressId, id);
    if (!address) throw new NotFoundException(`Address ${addressId} not found`);
    return address;
  }

  async createAddress(user: AppUser | undefined, dto: CreateAddressDto): Promise<AddressModel> {
    const { id } = this.require(user);
    if (dto.isDefault) {
      return this.prisma.runInTransaction(async (tx) => {
        await this.accountRepo.clearDefaultAddresses(id, tx);
        return this.accountRepo.createAddress(id, dto, tx);
      });
    }
    return this.accountRepo.createAddress(id, dto);
  }

  async updateAddress(
    user: AppUser | undefined,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<AddressModel> {
    const { id } = this.require(user);
    const existing = await this.accountRepo.findAddress(addressId, id);
    if (!existing) throw new NotFoundException(`Address ${addressId} not found`);
    if (dto.isDefault) {
      return this.prisma.runInTransaction(async (tx) => {
        await this.accountRepo.clearDefaultAddresses(id, tx);
        return this.accountRepo.updateAddress(addressId, dto, tx);
      });
    }
    return this.accountRepo.updateAddress(addressId, dto);
  }

  async removeAddress(user: AppUser | undefined, addressId: string): Promise<void> {
    const { id } = this.require(user);
    const existing = await this.accountRepo.findAddress(addressId, id);
    if (!existing) throw new NotFoundException(`Address ${addressId} not found`);
    await this.accountRepo.deleteAddress(addressId);
  }

  getPreferences(user: AppUser | undefined): Promise<UserPreferencesModel> {
    const { id } = this.require(user);
    return this.accountRepo.upsertPreferences(id);
  }

  updatePreferences(
    user: AppUser | undefined,
    dto: UpdatePreferencesDto,
  ): Promise<UserPreferencesModel> {
    const { id } = this.require(user);
    return this.accountRepo.upsertPreferences(id, dto);
  }
}
