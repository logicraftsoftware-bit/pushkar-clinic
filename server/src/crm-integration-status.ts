import type { RequestHandler } from 'express';
import { config } from './config.js';

// Keep connection keys and imported records intact while synchronization is paused.
export const requireCrmIntegration: RequestHandler = (_request, response, next) => {
  if (config.CRM_INTEGRATION_ENABLED !== 'true') {
    response.status(503).json({ error: 'CRM integration is temporarily disconnected' });
    return;
  }
  next();
};
