import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as clientsService from './clients.service.js';
import * as contactsService from './client-contacts.service.js';
import * as notesService from './client-notes.service.js';
import * as tagsService from './tags.service.js';
import * as timelineService from './timeline.service.js';
import * as fileLinksService from './entity-file-links.service.js';
import { searchClients, searchClientsWithData } from './search-index.service.js';
import * as clientCardService from './client-card.service.js';
import * as clientImportExport from './client-import-export.service.js';

const router = Router();
const ENTITY_TYPE_CLIENT = 'client';

router.get('/:id/clients', authMiddleware, requireOrg, requirePermission('clients:read', 'view_clients'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const view = typeof req.query.view === 'string' ? req.query.view : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const sort_by = typeof req.query.sort_by === 'string' ? req.query.sort_by : undefined;
    const sort_dir = req.query.sort_dir === 'desc' ? 'desc' : 'asc';
    const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
    const offset = req.query.offset != null ? parseInt(String(req.query.offset), 10) : undefined;
    const result = await clientsService.listClients(req.context!, req.params.id, {
      view,
      search,
      includeArchived,
      sort_by,
      sort_dir,
      limit,
      offset,
    });
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const client = await clientsService.createClient(req.context!, req.params.id, req.body);
    return res.status(201).json(client);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/search', authMiddleware, requireOrg, requirePermission('clients:read', 'view_clients'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const q = String(req.query.q ?? '').trim();
    const includeArchived = req.query.includeArchived === 'true';
    const full = req.query.full === 'true';
    if (full && q) {
      const includeSensitive = req.context!.membership?.permissions?.includes('clients:view_sensitive');
      const clients = await searchClientsWithData(req.params.id, q, { includeArchived, includeSensitive });
      return res.json({ results: clients });
    }
    const results = await searchClients(req.params.id, q, { includeArchived });
    return res.json({ results });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/import/preview', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const preview = await clientImportExport.previewImport(req.context!, req.params.id, csv);
    return res.json(preview);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/import', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const result = await clientImportExport.executeImport(req.context!, req.params.id, csv);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/export', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const csv = await clientImportExport.exportClientsCsv(req.context!, req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-export.csv"');
    return res.send(csv);
  } catch (e) {
    next(e);
  }
});

// Bulk actions (must be before /:id/clients/:clientId)
router.post('/:id/clients/bulk/mark-active', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const result = await clientsService.bulkMarkActive(req.context!, req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});
router.post('/:id/clients/bulk/mark-inactive', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const result = await clientsService.bulkMarkInactive(req.context!, req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});
router.post('/:id/clients/bulk/archive', authMiddleware, requireOrg, requirePermission('clients:archive'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const result = await clientsService.bulkArchive(req.context!, req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});
router.post('/:id/clients/bulk/restore', authMiddleware, requireOrg, requirePermission('clients:archive'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const result = await clientsService.bulkRestore(req.context!, req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});
router.post('/:id/clients/bulk/export', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds.filter((id: unknown) => typeof id === 'string') : [];
    const csv = await clientImportExport.exportSelectedClientsCsv(req.context!, req.params.id, clientIds);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-selected-export.csv"');
    return res.send(csv);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/:clientId', authMiddleware, requireOrg, requirePermission('clients:read', 'view_clients'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const includeSensitive = req.context!.membership?.permissions?.includes('clients:view_sensitive');
    const client = await clientsService.getClientById(req.context!, req.params.id, req.params.clientId, { includeSensitive });
    return res.json(client);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/:clientId/full', authMiddleware, requireOrg, requirePermission('clients:read', 'view_clients'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const data = await clientCardService.getClientCardData(req.context!, req.params.id, req.params.clientId);
    return res.json(data);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/clients/:clientId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const client = await clientsService.updateClient(req.context!, req.params.id, req.params.clientId, req.body);
    return res.json(client);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/archive', authMiddleware, requireOrg, requirePermission('clients:archive'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const client = await clientsService.archiveClient(req.context!, req.params.id, req.params.clientId);
    return res.json(client);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/restore', authMiddleware, requireOrg, requirePermission('clients:archive'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const client = await clientsService.restoreClient(req.context!, req.params.id, req.params.clientId);
    return res.json(client);
  } catch (e) {
    next(e);
  }
});

// Contacts
router.get('/:id/clients/:clientId/contacts', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await contactsService.listContacts(req.context!, req.params.id, req.params.clientId);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/contacts', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const contact = await contactsService.addContact(req.context!, req.params.id, req.params.clientId, req.body);
    return res.status(201).json(contact);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/clients/:clientId/contacts/:contactId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const contact = await contactsService.updateContact(req.context!, req.params.id, req.params.clientId, req.params.contactId, req.body);
    return res.json(contact);
  } catch (e) {
    next(e);
  }
});

router.put('/:id/clients/:clientId/contacts/:contactId/primary', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const contact = await contactsService.setPrimaryContact(req.context!, req.params.id, req.params.clientId, req.params.contactId);
    return res.json(contact);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/clients/:clientId/contacts/:contactId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await contactsService.deleteContact(req.context!, req.params.id, req.params.clientId, req.params.contactId);
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Notes
router.get('/:id/clients/:clientId/notes', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const includeSensitive = req.context!.membership?.permissions?.includes('clients:view_sensitive');
    const list = await notesService.listNotes(req.context!, req.params.id, req.params.clientId, { includeSensitive });
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/notes', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const note = await notesService.addNote(req.context!, req.params.id, req.params.clientId, req.body);
    return res.status(201).json(note);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/clients/:clientId/notes/:noteId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const note = await notesService.updateNote(req.context!, req.params.id, req.params.clientId, req.params.noteId, req.body);
    return res.json(note);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/clients/:clientId/notes/:noteId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await notesService.deleteNote(req.context!, req.params.id, req.params.clientId, req.params.noteId);
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/:clientId/notes/:noteId/sensitive', authMiddleware, requireOrg, requirePermission('clients:view_sensitive'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const out = await notesService.viewSensitiveNote(req.context!, req.params.id, req.params.clientId, req.params.noteId);
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

// Tags (org-level list + client tag links)
router.get('/:id/tags', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await tagsService.listTags(req.context!, req.params.id);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/tags', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const tag = await tagsService.createTag(req.context!, req.params.id, req.body);
    return res.status(201).json(tag);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/:clientId/tags', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await tagsService.listTagsForClient(req.context!, req.params.id, req.params.clientId);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/tags', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { tagId } = req.body;
    if (!tagId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'tagId required' });
    const link = await tagsService.addTagToClient(req.context!, req.params.id, req.params.clientId, tagId);
    return res.status(201).json(link);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/clients/:clientId/tags/:tagId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await tagsService.removeTagFromClient(req.context!, req.params.id, req.params.clientId, req.params.tagId);
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Timeline
router.get('/:id/clients/:clientId/timeline', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await timelineService.getTimelineForEntity(req.params.id, ENTITY_TYPE_CLIENT, req.params.clientId);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

// File links
router.get('/:id/clients/:clientId/files', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await fileLinksService.listFilesForClient(req.context!, req.params.id, req.params.clientId);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/clients/:clientId/files', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const link = await fileLinksService.attachFileToClient(req.context!, req.params.id, req.params.clientId, req.body);
    return res.status(201).json(link);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/clients/:clientId/files/:fileAssetId/open', authMiddleware, requireOrg, requirePermission('clients:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { url } = await fileLinksService.getFileOpenUrl(req.context!, req.params.id, req.params.clientId, req.params.fileAssetId);
    return res.json({ url });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/clients/:clientId/files/:fileAssetId', authMiddleware, requireOrg, requirePermission('clients:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await fileLinksService.removeFileFromClient(req.context!, req.params.id, req.params.clientId, req.params.fileAssetId);
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export const clientsRoutes = router;
