import { qualifyReferrals } from '../services/referralService.js';

/**
 * Growth jobs — referral qualification.
 *
 * A referral sits PENDING until the business it brought in actually issues an
 * invoice; that is the point at which it becomes worth rewarding. The check is
 * a plain count, so the job is cheap and safe to run on a schedule.
 */

export default {
  'referral.qualify': async () => {
    const report = await qualifyReferrals();
    if (report.activated || report.expired) {
      console.log(`[job] referrals: ${report.activated} activated, ${report.expired} expired (${report.scanned} pending scanned)`);
    } else {
      console.log(`[job] referrals: nothing to qualify (${report.scanned} pending)`);
    }
  },
};

export const periodicTasks = [{ type: 'referral.qualify', everyMs: 60 * 60 * 1000, payload: {} }];
