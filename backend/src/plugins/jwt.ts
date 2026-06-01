import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';

export default fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });
});
