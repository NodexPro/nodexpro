import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as documentsService from './documents.service.js';
import * as documentVersionsService from './document-versions.service.js';
import * as documentUploadService from './document-upload.service.js';
import * as documentLinksService from './document-links.service.js';
import * as documentCardService from './document-card.service.js';
const router = Router();
router.get('/:id/documents', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const includeArchived = req.query.includeArchived === 'true';
        const documentType = req.query.documentType;
        const primaryClientId = req.query.primaryClientId;
        const linkedToClientId = req.query.linkedToClientId;
        const list = await documentsService.listDocuments(req.context, req.params.id, { includeArchived, documentType, primaryClientId, linkedToClientId });
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/documents/upload', authMiddleware, requireOrg, requirePermission('documents:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const result = await documentUploadService.uploadDocument(req.context, req.params.id, req.body);
        return res.status(201).json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/documents/:documentId', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const full = req.query.full === 'true';
        if (full) {
            const data = await documentCardService.getDocumentCardData(req.context, req.params.id, req.params.documentId);
            return res.json(data);
        }
        const doc = await documentsService.getDocumentById(req.context, req.params.id, req.params.documentId);
        return res.json(doc);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/:id/documents/:documentId', authMiddleware, requireOrg, requirePermission('documents:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const doc = await documentsService.updateDocument(req.context, req.params.id, req.params.documentId, req.body);
        return res.json(doc);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/documents/:documentId/archive', authMiddleware, requireOrg, requirePermission('documents:archive'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const doc = await documentsService.archiveDocument(req.context, req.params.id, req.params.documentId);
        return res.json(doc);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/documents/:documentId/versions', authMiddleware, requireOrg, requirePermission('documents:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const version = await documentUploadService.uploadNewVersion(req.context, req.params.id, req.params.documentId, req.body);
        return res.status(201).json(version);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/documents/:documentId/versions', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const list = await documentVersionsService.listVersions(req.context, req.params.id, req.params.documentId);
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/documents/:documentId/open', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const versionId = req.query.versionId;
        const { url } = await documentVersionsService.getDocumentOpenUrl(req.context, req.params.id, req.params.documentId, versionId);
        return res.json({ url });
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/documents/:documentId/links', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const list = await documentLinksService.listLinks(req.context, req.params.id, req.params.documentId);
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/documents/:documentId/links', authMiddleware, requireOrg, requirePermission('documents:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const link = await documentLinksService.addLink(req.context, req.params.id, req.params.documentId, req.body);
        return res.status(201).json(link);
    }
    catch (e) {
        next(e);
    }
});
router.delete('/:id/documents/:documentId/links/:linkId', authMiddleware, requireOrg, requirePermission('documents:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        await documentLinksService.removeLink(req.context, req.params.id, req.params.documentId, req.params.linkId);
        return res.status(204).send();
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/documents/:documentId/activity', authMiddleware, requireOrg, requirePermission('documents:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const list = await documentsService.getDocumentActivity(req.context, req.params.id, req.params.documentId);
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
export const documentsRoutes = router;
