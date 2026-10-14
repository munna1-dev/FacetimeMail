import type { IncomingMessage, ServerResponse } from 'node:http';

type ApiServerModule = typeof import('../../apps/api/dist/server.js');

let serverModulePromise: Promise<ApiServerModule> | undefined;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  serverModulePromise ??= import('../../apps/api/dist/server.js');

  const { handleRequest } = await serverModulePromise;
  await handleRequest(req, res);
}
