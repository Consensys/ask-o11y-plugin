package graphiti

// Episode is a unit of information added to the knowledge graph.
// The Graphiti REST API accepts this at POST /v1/episodes.
// GroupID isolates data per org: "org_{orgID}".
type Episode struct {
	Name              string            `json:"name"`
	EpisodeBody       string            `json:"episode_body"`
	Source            string            `json:"source"` // "text" | "json" | "message"
	SourceDescription string            `json:"source_description"`
	GroupID           string            `json:"group_id"`
	ReferenceTime     string            `json:"reference_time,omitempty"` // RFC3339
	EntityTypes       map[string]string `json:"entity_types,omitempty"`  // name → description
}

// Message represents a conversational message for POST /v1/messages.
type Message struct {
	Content           string `json:"content"`
	RoleType          string `json:"role_type"` // "user" | "assistant" | "system"
	Role              string `json:"role,omitempty"`
	Name              string `json:"name,omitempty"`
	Timestamp         string `json:"timestamp"`           // RFC3339
	SourceDescription string `json:"source_description,omitempty"`
}

// AddMessagesRequest is the payload for POST /v1/messages.
type AddMessagesRequest struct {
	GroupID  string    `json:"group_id"`
	Messages []Message `json:"messages"`
}

// GetMemoryRequest is the payload for POST /v1/get-memory.
type GetMemoryRequest struct {
	GroupID    string    `json:"group_id"`
	Messages   []Message `json:"messages"`
	MaxFacts   int       `json:"max_facts,omitempty"`
}

// GetMemoryResponse is the response from POST /v1/get-memory.
type GetMemoryResponse struct {
	Facts []EntityEdge `json:"facts"`
	Nodes []EntityNode `json:"entities"`
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

// ObservabilityEntityTypes returns entity type hints optimized for observability
// data. Graphiti uses these to guide LLM-based entity extraction — providing a
// prescribed ontology dramatically improves extraction accuracy.
func ObservabilityEntityTypes() map[string]string {
	return map[string]string{
		"Service":        "A microservice, application, or workload (e.g., api-gateway, auth-service, payment-worker)",
		"Database":       "A data store such as PostgreSQL, MySQL, Redis, MongoDB, Elasticsearch, or ClickHouse",
		"Queue":          "A message broker or queue such as Kafka, RabbitMQ, SQS, NATS, or Pub/Sub",
		"Infrastructure": "Cloud or cluster infrastructure: Kubernetes cluster, node pool, load balancer, CDN, or cloud region",
		"Namespace":      "A Kubernetes namespace or logical deployment grouping",
		"Dashboard":      "A Grafana dashboard that monitors one or more services",
		"Alert":          "An alerting rule or firing alert condition",
		"Datasource":     "A Grafana datasource such as Prometheus, Loki, Tempo, Mimir, or Jaeger",
		"Team":           "An engineering team, on-call group, or organizational owner",
	}
}
