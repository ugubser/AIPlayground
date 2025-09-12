import { Response } from 'firebase-functions';

export function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };
}

export function handleCorsPreflightRequest(res: Response): void {
  const corsHeaders = getCorsHeaders();
  Object.keys(corsHeaders).forEach(key => {
    res.set(key, corsHeaders[key]);
  });
  res.status(200).end();
}