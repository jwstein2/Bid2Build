-- STAGING ONLY. Run once the growth-worker function is deployed and its secrets are set.
-- Ticks every minute. The system still does nothing until an operator resumes it.
select cron.schedule('growth-tick', '* * * * *', 'select growth.cron_tick()');
-- select growth_api.resume('staging verified');   -- operator step
-- Kill switch: select cron.unschedule('growth-tick');
