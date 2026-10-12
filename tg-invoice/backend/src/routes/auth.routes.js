import { Router } from 'express';
import { requireAuth, optionalTenant } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { validate } from '../middleware/errorHandler.js';
import * as auth from '../controllers/authController.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, changePasswordSchema, updateProfileSchema } from '../validators/authValidators.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), auth.resetPassword);
router.post('/verify-email', validate(verifyEmailSchema), auth.verifyEmail);
router.post('/resend-verification', requireAuth, auth.resendVerification);
router.get('/me', requireAuth, optionalTenant, auth.me);
router.put('/me', requireAuth, optionalTenant, validate(updateProfileSchema), auth.updateProfile);
router.post('/change-password', requireAuth, validate(changePasswordSchema), auth.changePassword);

export default router;
