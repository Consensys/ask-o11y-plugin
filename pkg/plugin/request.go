package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// Request body caps for the plugin's own HTTP handlers. The Graphiti ingest
// route keeps its own, larger budget (GraphitiIngestMaxBodyBytes).
const (
	// maxRequestBodyBytes bounds the small JSON control payloads (tool calls,
	// approval decisions, sharing, provisioner bodies).
	maxRequestBodyBytes = 1 << 20
	// maxSessionBodyBytes bounds session create/update, which carry the whole
	// transcript and can legitimately be much larger than a control request.
	maxSessionBodyBytes = 8 << 20
)

// decodeJSONBody decodes a JSON request body into dst with a hard byte cap.
// It writes the error response itself and returns the decode error, so a
// handler needs one line. When the body exceeds limit the client receives
// 413; any other decode failure receives 400.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeBodyDecodeError(w, err)
		return err
	}
	return nil
}

// decodeOptionalJSONBody behaves like decodeJSONBody but treats an empty body
// as success, for handlers where the payload is optional.
func decodeOptionalJSONBody(w http.ResponseWriter, r *http.Request, dst any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		writeBodyDecodeError(w, err)
		return err
	}
	return nil
}

func writeBodyDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		http.Error(w, fmt.Sprintf("Request body exceeds %d bytes", tooLarge.Limit), http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, "Invalid request body", http.StatusBadRequest)
}
