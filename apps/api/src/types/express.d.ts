import type { FamilyRole, User } from '@prisma/client';
import type { FamilyContext } from '../services/permissionService';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: User;
      familyCtx?: FamilyContext;
      familyRole?: FamilyRole;
    }
  }
}

export {};

