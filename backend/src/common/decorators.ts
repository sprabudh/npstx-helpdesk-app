import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Principal, Role } from '../domain/types';

export const IS_PUBLIC = 'isPublic';
/** Route does not need a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_ANY = 'rolesAny';
/** Route needs at least one of these roles (checked against roles loaded from the database). */
export const RequireAnyRole = (...roles: Role[]) => SetMetadata(ROLES_ANY, roles);

/** The signed-in person for this request. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest().principal);
