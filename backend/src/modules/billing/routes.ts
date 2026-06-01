import { FastifyInstance } from 'fastify';
import { authGuard } from '../../lib/auth.js';

export async function billingRoutes(app: FastifyInstance) {
  app.get('/plans', { preHandler: authGuard }, async () => {
    return [
      { id: 'free', name: 'Free', price: 0, features: ['1 Database', '1 GB Storage'], current: false },
      { id: 'starter', name: 'Starter', price: 49, features: ['5 Databases', '50 GB Storage'], current: false },
      { id: 'pro', name: 'Pro', price: 149, features: ['Unlimited Databases', '500 GB Storage'], current: true },
      { id: 'enterprise', name: 'Enterprise', price: 499, features: ['SSO', 'Audit Logs', 'Dedicated Support'], current: false },
    ];
  });
}
