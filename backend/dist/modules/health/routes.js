export async function healthRoutes(app) {
    app.get('/', async () => ({ ok: true }));
}
