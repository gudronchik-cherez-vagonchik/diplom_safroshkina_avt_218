import { resolveApiKeyUser } from '../modules/apikeys/service.js';
export async function apiKeyGuard(request, reply) {
    const raw = request.headers.authorization;
    if (!raw?.startsWith('Bearer ')) {
        return reply.code(401).send({
            message: 'Укажите заголовок Authorization со значением Bearer и секретным ключом',
        });
    }
    const token = raw.slice('Bearer '.length).trim();
    const resolved = await resolveApiKeyUser(token);
    if (!resolved) {
        return reply.code(401).send({ message: 'Неверный или отозванный API-ключ' });
    }
    request.apiKeyUserId = resolved.userId;
}
