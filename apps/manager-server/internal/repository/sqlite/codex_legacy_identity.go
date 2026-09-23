package sqlite

const (
	usageCodexLegacyIdentityEvidenceTable  = "usage_codex_legacy_identity_evidence_v1"
	usageCodexLegacyIdentityRollupName     = "codex_legacy_identity_v1"
	usageCodexLegacyIdentityEvidenceLegacy = "usage_codex_legacy_identity_evidence_v1_legacy_recovery"

	// This table and its primary key are created empty. Historical evidence is
	// populated by the post-listener worker, never by startup migrations.
	createUsageCodexLegacyIdentityEvidenceTable = `create table if not exists usage_codex_legacy_identity_evidence_v1 (
		structure_revision text not null,
		physical_kind integer not null,
		physical_file text collate nocase not null,
		auth_index text collate nocase not null,
		provider text not null,
		auth_provider_snapshot text not null,
		auth_account_id_snapshot text not null,
		auth_project_id_snapshot text not null,
		account_snapshot text not null,
		min_evidence_at_ms integer not null,
		max_evidence_at_ms integer not null,
		chronology_unknown integer not null,
		primary key (
			structure_revision, physical_kind, physical_file, auth_index,
			provider, auth_provider_snapshot, auth_account_id_snapshot,
			auth_project_id_snapshot, account_snapshot
		)
	)`
)
