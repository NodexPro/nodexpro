import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Example module', moduleCode: 'example', version: '1.0.0' });
});

export const exampleModuleRouter = Router();
exampleModuleRouter.use(authMiddleware, requireOrg, requireModuleActive('example'), router);
