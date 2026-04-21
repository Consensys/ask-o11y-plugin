package mcp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"testing"
)

func TestClassifyError(t *testing.T) {
	bgCtx := context.Background()
	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel()

	tests := []struct {
		name string
		ctx  context.Context
		err  error
		want ErrorKind
	}{
		{"nil error", bgCtx, nil, ""},
		{"canceled via ctx", cancelCtx, errors.New("anything"), ErrKindCanceled},
		{"errors.Is context.Canceled", bgCtx, fmt.Errorf("wrapped: %w", context.Canceled), ErrKindCanceled},
		{"deadline exceeded", bgCtx, fmt.Errorf("wrapped: %w", context.DeadlineExceeded), ErrKindCanceled},
		{"io.EOF", bgCtx, io.EOF, ErrKindTransport},
		{"io.ErrUnexpectedEOF", bgCtx, io.ErrUnexpectedEOF, ErrKindTransport},
		{"url.Error timeout", bgCtx, &url.Error{Op: "Post", URL: "http://x", Err: &timeoutErr{}}, ErrKindTransport},
		{"net.OpError", bgCtx, &net.OpError{Op: "read", Err: errors.New("x")}, ErrKindTransport},
		{"connection refused substring", bgCtx, errors.New("dial tcp: connection refused"), ErrKindTransport},
		{"connection reset substring", bgCtx, errors.New("read tcp: connection reset by peer"), ErrKindTransport},
		{"connection closed substring", bgCtx, errors.New("connection closed"), ErrKindTransport},
		{"client is closing", bgCtx, errors.New("client is closing"), ErrKindTransport},
		{"EOF substring uppercase", bgCtx, errors.New("unexpected EOF"), ErrKindTransport},
		{"no such host", bgCtx, errors.New("lookup foo: no such host"), ErrKindTransport},
		{"i/o timeout", bgCtx, errors.New("read: i/o timeout"), ErrKindTransport},
		{"unauthorized", bgCtx, errors.New("unauthorized"), ErrKindProtocol},
		{"forbidden", bgCtx, errors.New("forbidden"), ErrKindProtocol},
		{"method not found", bgCtx, errors.New("jsonrpc error: method not found"), ErrKindProtocol},
		{"unknown error defaults to protocol", bgCtx, errors.New("something weird"), ErrKindProtocol},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyError(tc.ctx, tc.err)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestTransportError_UnwrapAndMessage(t *testing.T) {
	inner := errors.New("underlying eof")
	te := &TransportError{Err: inner}
	if !errors.Is(te, inner) {
		t.Fatal("expected errors.Is to reach underlying error")
	}
	if got := te.Error(); got == "" {
		t.Fatal("empty error message")
	}
	var zero *TransportError
	if msg := (&TransportError{}).Error(); msg == "" {
		t.Fatal("zero-value TransportError should still produce a message")
	}
	_ = zero
}

type timeoutErr struct{}

func (timeoutErr) Error() string { return "timeout" }
func (timeoutErr) Timeout() bool { return true }
