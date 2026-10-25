import { isIP } from 'node:net';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { BadRequestException } from '@nestjs/common';
import { API_CONTRACT_VERSION, API_CONTRACT_VERSION_HEADER } from '@automaker/contracts';

import type { RuntimeConfig } from '../config/index.js';
import { requireJsonContentType } from '../../middleware/require-json-content-type.js';
import { PreviewPolicy } from '../config/preview-policy.js';

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0' ||
      (isIP(hostname) === 4 &&
        (hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)))
    );
  } catch {
    return false;
  }
}

export function createPlatformMiddleware(
  config: RuntimeConfig,
  preview = new PreviewPolicy(config.preview)
): RequestHandler[] {
  const allowedOrigins = config.server.corsOrigins;
  const json = express.json({ limit: '50mb' });
  return [
    (_request, response, next) => {
      response.setHeader(API_CONTRACT_VERSION_HEADER, API_CONTRACT_VERSION);
      next();
    },
    preview.apiGuard,
    cors({
      credentials: true,
      origin(origin, callback) {
        if (
          !origin ||
          allowedOrigins.includes('*') ||
          allowedOrigins.includes(origin) ||
          isLocalOrigin(origin)
        ) {
          callback(null, origin ?? true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
    }),
    requireJsonContentType,
    (request, response, next) =>
      json(request, response, (error?: unknown) => {
        // Parser messages can contain excerpts of credential-bearing request bodies.
        if (
          error &&
          typeof error === 'object' &&
          'type' in error &&
          error.type === 'entity.parse.failed'
        ) {
          next(new BadRequestException({ success: false, error: 'Invalid JSON request body.' }));
          return;
        }
        next(error);
      }),
    cookieParser(),
  ];
}
