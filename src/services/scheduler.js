import cron from 'node-cron';
import { settings } from '../config/settings.js';
import { runDailyJob } from './dailyJob.js';

export function startScheduler() {
  const cfg = settings();
  if (!cfg.enableScheduler) return null;
  return cron.schedule(cfg.dailyJobCron, () => {
    runDailyJob().catch((e) => console.error('[daily job] failed:', e));
  });
}
