import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { env } from '../common/env';
import { UserEntity, UserHrCategoryEntity, UserRoleEntity } from '../database/entities';
import { Principal, Role } from '../domain/types';

@Injectable()
export class AuthService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly jwt: JwtService) {}

  /**
   * Short-lived token that carries only the user id, plus `psh` (hash of the portal session) when it was
   * issued by the portal bridge.
   */
  issueToken(userId: string, extra: { psh?: string } = {}): { accessToken: string; expiresIn: number } {
    return { accessToken: this.jwt.sign({ sub: userId, ...extra }, { expiresIn: env.jwtTtlSeconds }), expiresIn: env.jwtTtlSeconds };
  }

  verify(token: string): string | null {
    return this.verifyClaims(token)?.sub ?? null;
  }

  verifyClaims(token: string): { sub: string; psh?: string } | null {
    try {
      const p = this.jwt.verify<{ sub: string; psh?: unknown }>(token);
      if (typeof p.sub !== 'string') return null;
      return { sub: p.sub, ...(typeof p.psh === 'string' ? { psh: p.psh } : {}) };
    } catch {
      return null;
    }
  }

  /** Roles, department and HR categories are always read from the database, never from the token. */
  async loadPrincipal(userId: string): Promise<Principal | null> {
    const u = await this.ds.getRepository(UserEntity).findOne({ where: { id: userId } });
    if (!u || u.isQueue || !u.active) return null;
    const [roles, hr] = await Promise.all([
      this.ds.getRepository(UserRoleEntity).find({ where: { userId } }),
      this.ds.getRepository(UserHrCategoryEntity).find({ where: { userId } }),
    ]);
    return {
      id: u.id, name: u.name, dept: u.dept, title: u.title, location: u.location, managerId: u.managerId,
      roles: new Set(roles.map((r) => r.role as Role)), hrCats: new Set(hr.map((h) => h.categoryKey)),
    };
  }

  async userIdByEmail(email: string): Promise<string | null> {
    const u = await this.ds.getRepository(UserEntity).findOne({ where: { email: email.toLowerCase(), isQueue: false } });
    return u?.id ?? null;
  }
}
