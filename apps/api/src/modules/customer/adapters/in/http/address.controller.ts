import {
  type AddressBody,
  type AddressDto,
  type AddressListDto,
  addressBodySchema,
} from '@commerce/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import { AddressId } from '../../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import {
  MANAGE_ADDRESSES_USECASE,
  type ManageAddressesUseCase,
} from '../../../application/ports/in/manage-addresses.usecase';
import {
  GET_ADDRESS_BOOK_QUERY,
  type GetAddressBookQuery,
} from '../../../application/ports/in/queries/get-address-book.query';
import type { AddressView } from '../../../application/ports/out/address.query';

/**
 * `AddressView`(애플리케이션의 읽기 모델) → `AddressDto`(와이어 계약).
 * 지금은 모양이 같아 한 줄이지만, 계약이 갈라지는 순간 이 한 줄만 바뀐다.
 */
function toDto(view: AddressView): AddressDto {
  return {
    id: view.id,
    label: view.label,
    recipient: view.recipient,
    phone: view.phone,
    zip: view.zip,
    line1: view.line1,
    ...(view.line2 === null ? {} : { line2: view.line2 }),
    isDefault: view.isDefault,
  };
}

@Controller('addresses')
@UseGuards(AccessTokenGuard)
export class AddressController {
  constructor(
    @Inject(MANAGE_ADDRESSES_USECASE) private readonly addresses: ManageAddressesUseCase,
    @Inject(GET_ADDRESS_BOOK_QUERY) private readonly addressBook: GetAddressBookQuery,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<AddressListDto> {
    const views = await this.addressBook.execute({ customerId: principal.customerId });
    return { addresses: views.map(toDto) };
  }

  @Post()
  @HttpCode(201)
  async add(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(addressBodySchema)) body: AddressBody,
  ): Promise<AddressDto> {
    const view = await this.addresses.add({
      customerId: principal.customerId,
      details: body,
    });
    return toDto(view);
  }

  @Put(':addressId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
    @Body(new ZodValidationPipe(addressBodySchema)) body: AddressBody,
  ): Promise<AddressDto> {
    const view = await this.addresses.update({
      customerId: principal.customerId,
      // AddressId.of가 InvalidIdError(400)를 던진다 — 경로 파라미터는 사용자 입력이므로
      // 400이 맞다. 이것이 태스크 1에서 `of`와 `fromPersistence`를 가른 이유다.
      addressId: AddressId.of(addressId),
      details: body,
    });
    return toDto(view);
  }

  @Delete(':addressId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.remove({
      customerId: principal.customerId,
      addressId: AddressId.of(addressId),
    });
  }

  @Post(':addressId/default')
  @HttpCode(204)
  async setDefault(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.setDefault({
      customerId: principal.customerId,
      addressId: AddressId.of(addressId),
    });
  }
}
