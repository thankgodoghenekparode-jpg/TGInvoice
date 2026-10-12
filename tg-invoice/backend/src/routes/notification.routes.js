import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as notifications from '../controllers/notificationController.js';

/**
 * Notification routes — authenticated but NOT tenant-scoped: a notification
 * belongs to a user (platform operators belong to no business). Every handler
 * scopes its query to req.user.id.
 */
const router = Router();

router.use(requireAuth);

router.get('/', notifications.list);
router.get('/unread-count', notifications.unreadCount);
router.post('/read-all', notifications.markAllRead);
router.post('/:id/read', notifications.markRead);

export default router;
