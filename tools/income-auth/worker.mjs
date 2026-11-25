import { DurableObject } from 'cloudflare:workers';
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { AuthService } from './service.mjs';
import { AuthStore } from './store.mjs';
import { decorate, errorResponse } from './core.mjs';

const webauthn = { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse };

export class IncomeAuth extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.queue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      this.store = new AuthStore(ctx.storage);
      this.service = new AuthService(env, this.store, webauthn);
    });
  }
  serialize(operation) {
    // DO input gates alone allow interleaving at external awaits. Serialize the entire operation.
    const pending = this.queue.then(operation);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  async scheduleCleanup() {
    const next = this.store.nextExpiry();
    if (next === null) { await this.ctx.storage.deleteAlarm(); return; }
    const current = await this.ctx.storage.getAlarm();
    // A batch of expired records is followed by another bounded batch, never a full table scan.
    const desired = Math.max(Date.now() + 1000, next);
    if (current === null || current > desired) await this.ctx.storage.setAlarm(desired);
  }
  fetch(request) {
    return this.serialize(async () => {
      try {
        this.store.purge(Date.now());
        const response = await this.service.fetch(request);
        await this.scheduleCleanup();
        return response;
      } catch (error) { return decorate(errorResponse(error), request); }
    });
  }
  alarm() {
    return this.serialize(async () => {
      this.store.purge(Date.now());
      await this.scheduleCleanup();
    });
  }
}

export default {
  async fetch(request, env) {
    try {
      // One fixed SQLite Durable Object for every route, including OAuth and vault forwarding.
      return await env.AUTH.get(env.AUTH.idFromName('owner')).fetch(request);
    } catch (error) { return decorate(errorResponse(error), request); }
  },
};
