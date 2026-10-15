import { Router } from 'express';
import * as attachments from '../controllers/attachmentController.js';

/** Files attached to any document. Tenant-scoped where mounted. */

export const attachmentRouter = Router();
attachmentRouter.get('/', attachments.listAttachments);
attachmentRouter.post('/', attachments.uploadMiddleware, attachments.createAttachment);
attachmentRouter.get('/:id/download', attachments.downloadAttachment);
attachmentRouter.delete('/:id', attachments.deleteAttachment);

export default attachmentRouter;
