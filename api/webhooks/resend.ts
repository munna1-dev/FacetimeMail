import type { IncomingMessage, ServerResponse } from 'node:http';

type ApiServerModule = typeof import('../../apps/api/dist/server.js');

let serverModulePromise: Promise<ApiServerModule> | undefined;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    serverModulePromise ??= import('../../apps/api/dist/server.js');

    const { handleRequest } = await serverModulePromise;
    await handleRequest(req, res);
  } catch (error) {
    console.error('Resend webhook entry point failed:', error);

    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'Webhook service temporarily unavailable.'
      }));
    }
  }
}
