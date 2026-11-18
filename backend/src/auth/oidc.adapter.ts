import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, createVerify, JsonWebKey } from 'crypto';
import { env } from '../common/env';

interface Jwk extends JsonWebKey { kid?: string; alg?: string }

/**
 * Production SSO adapter (AUTH_MODE=oidc). Verifies an RS256 ID or access token from the corporate identity
 * provider against its JWKS, checks issuer, audience and expiry, and returns the claim used to find the NPSTX user
 * (OIDC_USER_CLAIM, default "email"). The browser sign-in redirect itself is handled by the NPSTX platform shell.
 */
@Injectable()
export class OidcAdapter {
  private readonly log = new Logger('Oidc');
  private keys: Jwk[] = [];
  private fetchedAt = 0;

  enabled(): boolean {
    return env.authMode === 'oidc' && !!env.oidc.issuer && !!env.oidc.clientId;
  }

  private async jwks(): Promise<Jwk[]> {
    if (this.keys.length && Date.now() - this.fetchedAt < 3600000) return this.keys;
    const conf = await (await fetch(`${env.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)).json();
    const set = await (await fetch(conf.jwks_uri)).json();
    this.keys = set.keys;
    this.fetchedAt = Date.now();
    return this.keys;
  }

  /** Returns the user claim (for example the email) or null when the token is not valid. */
  async verify(token: string): Promise<string | null> {
    try {
      const [h, p, s] = token.split('.');
      const header = JSON.parse(Buffer.from(h, 'base64url').toString());
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (header.alg !== 'RS256') return null;
      const jwk = (await this.jwks()).find((k) => k.kid === header.kid);
      if (!jwk) return null;
      const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const now = Math.floor(Date.now() / 1000);
      if (!ok || claims.iss !== env.oidc.issuer || !aud.includes(env.oidc.audience || env.oidc.clientId) || !(claims.exp > now)) return null;
      return String(claims[env.oidc.userClaim] ?? '') || null;
    } catch (e) {
      this.log.warn(`OIDC token rejected: ${e instanceof Error ? e.message : 'invalid'}`);
      return null;
    }
  }
}
