package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONBody(t *testing.T) {
	t.Run("decodes a normal payload", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(`{"name":"a"}`))
		rec := httptest.NewRecorder()

		var dst struct {
			Name string `json:"name"`
		}
		if err := decodeJSONBody(rec, req, &dst, maxRequestBodyBytes); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if dst.Name != "a" {
			t.Fatalf("unexpected payload: %+v", dst)
		}
	})

	t.Run("rejects an oversized payload with 413", func(t *testing.T) {
		big := `{"pad":"` + strings.Repeat("x", int(maxRequestBodyBytes)+1024) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(big))
		rec := httptest.NewRecorder()

		var dst map[string]any
		err := decodeJSONBody(rec, req, &dst, maxRequestBodyBytes)
		if err == nil {
			t.Fatal("oversized body must fail")
		}
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("want 413, got %d", rec.Code)
		}
	})

	t.Run("malformed JSON gets 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(`{`))
		rec := httptest.NewRecorder()

		var dst map[string]any
		if err := decodeJSONBody(rec, req, &dst, maxRequestBodyBytes); err == nil {
			t.Fatal("malformed body must fail")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("want 400, got %d", rec.Code)
		}
	})
}

func TestDecodeOptionalJSONBody(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(""))

	var dst map[string]any
	if err := decodeOptionalJSONBody(rec, req, &dst, maxRequestBodyBytes); err != nil {
		t.Fatalf("empty body should be accepted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("empty body must not write an error, got %d", rec.Code)
	}
}
