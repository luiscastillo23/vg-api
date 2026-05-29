import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AccountService } from './account.service';
import { AddressResponseDto } from './dto/address-response.dto';
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from '../users/dto/address.dto';
import { UpdatePreferencesDto } from '../users/dto/update-preferences.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { AppUser } from '../../common/decorators/current-user.decorator';

const toUserDto = (user: unknown) =>
  plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });

const toAddressDto = (addr: unknown) =>
  plainToInstance(AddressResponseDto, addr, { excludeExtraneousValues: true });

const toPrefsDto = (prefs: unknown) =>
  plainToInstance(PreferencesResponseDto, prefs, { excludeExtraneousValues: true });

@ApiTags('account')
@ApiBearerAuth('clerk')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the caller's profile" })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not synced' })
  getMe(@CurrentUser() user: AppUser | undefined) {
    return toUserDto(this.accountService.getMe(user));
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's profile (name, phone, avatar)" })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not synced' })
  async updateMe(
    @CurrentUser() user: AppUser | undefined,
    @Body() dto: UpdateProfileDto,
  ) {
    return toUserDto(await this.accountService.updateMe(user, dto));
  }

  // ── Addresses ──────────────────────────────────────────────────────────────

  @Get('addresses')
  @ApiOperation({ summary: "List the caller's addresses" })
  @ApiResponse({ status: 200, type: [AddressResponseDto] })
  async listAddresses(@CurrentUser() user: AppUser | undefined) {
    const addresses = await this.accountService.listAddresses(user);
    return addresses.map(toAddressDto);
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new address' })
  @ApiResponse({ status: 201, type: AddressResponseDto })
  async createAddress(
    @CurrentUser() user: AppUser | undefined,
    @Body() dto: CreateAddressDto,
  ) {
    return toAddressDto(await this.accountService.createAddress(user, dto));
  }

  @Get('addresses/:id')
  @ApiOperation({ summary: 'Get a single address by ID' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async getAddress(
    @CurrentUser() user: AppUser | undefined,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return toAddressDto(await this.accountService.getAddress(user, id));
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Update an address' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async updateAddress(
    @CurrentUser() user: AppUser | undefined,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return toAddressDto(await this.accountService.updateAddress(user, id, dto));
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an address' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'Address deleted' })
  @ApiResponse({ status: 404, description: 'Address not found' })
  removeAddress(
    @CurrentUser() user: AppUser | undefined,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.accountService.removeAddress(user, id);
  }

  // ── Preferences ────────────────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: "Get the caller's notification and UI preferences" })
  @ApiResponse({ status: 200, type: PreferencesResponseDto })
  async getPreferences(@CurrentUser() user: AppUser | undefined) {
    return toPrefsDto(await this.accountService.getPreferences(user));
  }

  @Patch('preferences')
  @ApiOperation({ summary: "Update the caller's preferences" })
  @ApiResponse({ status: 200, type: PreferencesResponseDto })
  async updatePreferences(
    @CurrentUser() user: AppUser | undefined,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return toPrefsDto(await this.accountService.updatePreferences(user, dto));
  }
}
