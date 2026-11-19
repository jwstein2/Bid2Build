-- Rollback for 20270118001000_sales_v84_calendar.sql. Removes the calendar, time off, bookings and Google
-- connections. Events already added to reps' Google Calendars stay there.
drop function if exists public.admin_sales_booking_reassign(uuid, uuid, uuid);
drop function if exists public.admin_sales_bookings(uuid);
drop function if exists public.sales_calendar_mark(text, uuid, text, text, text);
drop function if exists public.sales_my_booking_cancel(uuid, text);
drop function if exists public.sales_my_time_off_cancel(uuid);
drop function if exists public.sales_my_time_off_save(uuid, timestamptz, timestamptz, boolean, text, text, text);
drop function if exists public.sales_my_event_delete(uuid);
drop function if exists public.sales_my_event_save(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid);
drop function if exists public.sales_my_calendar_settings_save(text, text, boolean, integer, integer, integer, integer, jsonb, text);
drop function if exists public.sales_my_calendar(timestamptz, timestamptz);
drop function if exists public.sales_me_rep();
drop function if exists public.sales_booking_reschedule(text, timestamptz, jsonb, timestamptz);
drop function if exists public.sales_booking_cancel(text, text);
drop function if exists public.sales_booking_by_token(text);
drop function if exists public.sales_booking_create(text, text, timestamptz, text, text, text, text, text, jsonb, timestamptz);
drop function if exists public.sales_booking_page(text);
drop function if exists public.sales_booking_slots(text, timestamptz, jsonb);
drop function if exists public.sales_rep_busy(uuid, timestamptz, timestamptz, integer, jsonb, uuid);
drop table if exists public.sales_google_connections;
drop table if exists public.sales_bookings;
drop table if exists public.sales_time_off;
drop table if exists public.sales_calendar_events;
drop table if exists public.sales_rep_calendar;
drop function if exists public.sales_rules_valid(jsonb);
drop function if exists public.sales_valid_tz(text);
