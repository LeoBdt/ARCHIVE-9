-- Tell the site something changed, so open pages refresh at once. Only the table name travels.
CREATE OR REPLACE FUNCTION archive9_notify_site() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('archive9', json_build_object('type', TG_TABLE_NAME)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER decisions_live AFTER INSERT ON decisions FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER actions_log_live AFTER INSERT OR UPDATE ON actions_log FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER profile_facts_live AFTER INSERT OR UPDATE ON profile_facts FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER relationship_events_live AFTER INSERT ON relationship_events FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER self_state_versions_live AFTER INSERT ON self_state_versions FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER skills_live AFTER INSERT OR UPDATE ON skills FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER settings_live AFTER INSERT OR UPDATE ON settings FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER feedback_live AFTER INSERT OR UPDATE ON feedback FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();
