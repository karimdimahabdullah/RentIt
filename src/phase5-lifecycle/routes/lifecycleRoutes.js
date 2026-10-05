/**
 * PHASE 5 routes - mounted as part of /api/bookings (see routes/bookingRoutes.js).
 * Auth is applied once by the combiner, not here. Every route runs
 * guard(actionKey) first - see middlewares/guard.js for the five checks.
 */
import { Router } from 'express';
import { guard } from '../../middlewares/guard.js';
import * as lifecycleController from '../controllers/lifecycleController.js';

const router = Router();

// ---- pickup / no-show ---------------------------------------------------------
router.post('/:id/pickup', guard('confirm_pickup'), lifecycleController.confirmPickup);
router.post('/:id/pickup/report-issue', guard('report_issue_at_pickup'), lifecycleController.reportIssueAtPickup);
router.post('/:id/no-show', guard('mark_no_show'), lifecycleController.markNoShow);
router.post('/:id/no-show/dispute', guard('dispute_no_show'), lifecycleController.disputeNoShow);

// ---- return ---------------------------------------------------------------------
router.post('/:id/return/claim', guard('claim_return'), lifecycleController.claimReturn);
router.post('/:id/return/confirm', guard('confirm_return'), lifecycleController.confirmReturn);
router.post('/:id/return/dispute', guard('dispute_return'), lifecycleController.disputeReturn);

// ---- completion -----------------------------------------------------------------
router.post('/:id/close', guard('close'), lifecycleController.close);
router.post('/:id/report-issue', guard('report_issue'), lifecycleController.reportIssue);

// ---- admin --------------------------------------------------------------------
router.post('/:id/resolve', guard('resolve'), lifecycleController.resolve);

export default router;
