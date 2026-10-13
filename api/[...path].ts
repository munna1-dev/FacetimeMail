import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../apps/api/dist/server.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleRequest(req, res);
}
