import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import type { UserModel } from '../../../generated/prisma/models/User';
import type { AddressModel } from '../../../generated/prisma/models/Address';
import type { UserPreferencesModel } from '../../../generated/prisma/models/UserPreferences';

type ProfilePatch = Partial<{
  firstName: string;
  lastName: string;
  phone: string | null;
  avatar: string | null;
}>;

type AddressData = {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  isDefault?: boolean;
};

type PreferencesPatch = Partial<{
  notifications: boolean;
  marketing: boolean;
  theme: string;
  language: string;
}>;

@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  updateProfile(id: string, data: ProfilePatch, tx?: PrismaTransactionClient): Promise<UserModel> {
    return (tx ?? this.prisma).user.update({ where: { id }, data });
  }

  findAddresses(userId: string): Promise<AddressModel[]> {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  findAddress(id: string, userId: string): Promise<AddressModel | null> {
    return this.prisma.address.findFirst({ where: { id, userId } });
  }

  createAddress(userId: string, data: AddressData, tx?: PrismaTransactionClient): Promise<AddressModel> {
    return (tx ?? this.prisma).address.create({ data: { ...data, userId } });
  }

  clearDefaultAddresses(userId: string, tx?: PrismaTransactionClient): Promise<unknown> {
    return (tx ?? this.prisma).address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  updateAddress(id: string, data: Partial<AddressData>, tx?: PrismaTransactionClient): Promise<AddressModel> {
    return (tx ?? this.prisma).address.update({ where: { id }, data });
  }

  deleteAddress(id: string): Promise<AddressModel> {
    return this.prisma.address.delete({ where: { id } });
  }

  upsertPreferences(userId: string, data: PreferencesPatch = {}): Promise<UserPreferencesModel> {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }
}
