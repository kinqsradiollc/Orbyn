-- Claims and recovery check the whole run, including settled segments.
CREATE INDEX assistant_work_job_history ON assistant_work_reservations(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX assistant_work_page_history ON assistant_work_reservations(page_run_id)
  WHERE page_run_id IS NOT NULL;
CREATE INDEX assistant_work_agenda_history ON assistant_work_reservations(agenda_run_id)
  WHERE agenda_run_id IS NOT NULL;
