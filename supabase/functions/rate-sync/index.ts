// Deployed via MCP — see tools/apps-script/rate-sync.gs for the sending side.
// Auth = anon JWT + HMAC-SHA256 (secret in sync_config). Promotion is atomic in
// promote_rate_sync(); cleanup_sample_room_types() sweeps after real data lands.
// Source of truth for this file is the deployed version (v2, 24 Aug 2026).
