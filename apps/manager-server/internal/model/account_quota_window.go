package model

// AccountQuotaObservation groups one provider quota inventory observation.
// InventoryMode is complete, partial, or delta. Complete observations can infer
// missing windows from omissions; delta observations use explicit removals.
type AccountQuotaObservation struct {
	ID                  int64
	ObservationHash     string
	AccountKey          string
	Provider            string
	Source              string
	SourceObservationID string
	InventoryScopeKey   string
	InventoryMode       string
	ObservedAtMS        int64
	WindowCount         int
	LifecycleApplied    bool
	CreatedAtMS         int64
}

type AccountQuotaWindowRemoval struct {
	ProviderWindowID string
	ModelScopeKind   string
	ModelScopeKey    string
	ModelIDsJSON     string
	ScopeFingerprint string
}

type AccountQuotaObservationWrite struct {
	Observation AccountQuotaObservation
	Snapshots   []AccountQuotaSnapshot
	Removed     []AccountQuotaWindowRemoval
	// ResponseIndex and InsertedSnapshotCount are internal plumbing used by the
	// service to report the number of rows actually persisted for each request
	// entry. They are intentionally not part of the database schema.
	ResponseIndex         int
	InsertedSnapshotCount int
}

type AccountQuotaCycle struct {
	ID                 int64
	ActivationID       int64
	ProviderCycleKey   string
	State              string
	ScheduledStartMS   *int64
	ScheduledEndMS     *int64
	ActualStartMS      int64
	ActualEndMS        *int64
	DurationSeconds    *int64
	BoundaryAccuracy   string
	EndReason          string
	FirstObservationID *int64
	LastObservationID  *int64
	ParentCycleID      *int64
	CreatedAtMS        int64
	UpdatedAtMS        int64
}

type AccountQuotaWindowState struct {
	ID                        int64
	AccountKey                string
	Provider                  string
	ProviderWindowID          string
	WindowKind                string
	WindowMode                string
	ModelScopeKind            string
	ModelScopeKey             string
	ModelIDsJSON              string
	ScopeFingerprint          string
	InventoryScopeKey         string
	RelationshipKind          string
	ContainerProviderWindowID string
	Availability              string
	Generation                int
	FirstSeenAtMS             int64
	LastSeenAtMS              int64
	MissingSinceMS            *int64
	DeactivatedAtMS           *int64
	ActivationID              int64
	CurrentCycle              *AccountQuotaCycle
	PreviousCycle             *AccountQuotaCycle
}
