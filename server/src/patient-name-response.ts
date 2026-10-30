import type { RequestHandler } from 'express';
import { displayPatientNames } from './patient-name-display.js';

export const patientNameResponse: RequestHandler = (_request, response, next) => {
  const json = response.json.bind(response);
  response.json = body => json(displayPatientNames(body));
  next();
};
