import { Router } from 'express';
import { mergePersonSchema, personSchema } from '@heirloom/shared';
import { asyncHandler } from '../http/asyncHandler';
import { clientMeta, currentUser } from '../middleware/auth';
import { familyCtx, requireFamily } from '../middleware/family';
import { writeLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import * as personService from '../services/personService';

export const peopleRouter = Router({ mergeParams: true });

peopleRouter.get(
  '/',
  requireFamily('person:read'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ people: await personService.listPeople(ctx, q) });
  }),
);

peopleRouter.post(
  '/',
  requireFamily('person:write'),
  writeLimiter,
  validateBody(personSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    res.status(201).json({ person: await personService.createPerson(user.id, ctx, req.body, clientMeta(req)) });
  }),
);

peopleRouter.get(
  '/:personId',
  requireFamily('person:read'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    res.json({ person: await personService.getPerson(user.id, ctx, req.params.personId!) });
  }),
);

peopleRouter.patch(
  '/:personId',
  requireFamily('person:write'),
  writeLimiter,
  validateBody(personSchema.partial()),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    res.json({ person: await personService.updatePerson(user.id, ctx, req.params.personId!, req.body, clientMeta(req)) });
  }),
);

peopleRouter.delete(
  '/:personId',
  requireFamily('person:delete'),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    await personService.deletePerson(user.id, ctx, req.params.personId!, clientMeta(req));
    res.status(204).end();
  }),
);

peopleRouter.post(
  '/:personId/merge',
  requireFamily('person:delete'),
  writeLimiter,
  validateBody(mergePersonSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const person = await personService.mergePerson(
      user.id,
      ctx,
      req.params.personId!,
      req.body.targetPersonId,
      clientMeta(req),
    );
    res.json({ person });
  }),
);

