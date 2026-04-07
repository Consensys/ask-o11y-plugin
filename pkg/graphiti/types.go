package graphiti

// Episode is a unit of information added to the knowledge graph.
// The Graphiti REST API accepts this at POST /v1/episodes.
// GroupID isolates data per org: "org_{orgID}".
type Episode struct {
	Name              string `json:"name"`
	EpisodeBody       string `json:"episode_body"`
	Source            string `json:"source"` // "text" | "json" | "message"
	SourceDescription string `json:"source_description"`
	GroupID           string `json:"group_id"`
	ReferenceTime     string `json:"reference_time,omitempty"` // RFC3339
}

// SearchRequest is sent to POST /v1/search.
type SearchRequest struct {
	Query      string   `json:"query"`
	GroupIDs   []string `json:"group_ids"`
	NumResults int      `json:"num_results,omitempty"`
}

// EntityNode is a discovered entity in the graph (service, component, team, etc.).
type EntityNode struct {
	UUID    string `json:"uuid"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

// EntityEdge is a temporal fact / relationship between entities.
type EntityEdge struct {
	UUID      string `json:"uuid"`
	Name      string `json:"name"`
	Fact      string `json:"fact"`
	ValidAt   string `json:"valid_at"`
	InvalidAt string `json:"invalid_at,omitempty"`
}

// SearchResponse holds the results from a hybrid graph search.
type SearchResponse struct {
	Nodes []EntityNode `json:"nodes"`
	Edges []EntityEdge `json:"edges"`
}
