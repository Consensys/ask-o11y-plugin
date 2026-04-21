package mcp

import (
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"strings"
)

// ErrorKind classifies errors returned from MCP operations so callers (retry,
// health monitor, agent loop) can distinguish transport failures from
// tool-layer logic errors.
type ErrorKind string

const (
	ErrKindTransport ErrorKind = "transport"
	ErrKindTool      ErrorKind = "tool"
	ErrKindProtocol  ErrorKind = "protocol"
	ErrKindCanceled  ErrorKind = "canceled"
)

// TransportError wraps an underlying network/transport error exhausted after
// retries. Callers detect it with errors.As to surface a clear "MCP is down"
// signal to the user instead of silently degrading.
type TransportError struct {
	Err error
}

func (e *TransportError) Error() string {
	if e == nil || e.Err == nil {
		return "mcp transport error"
	}
	return "mcp transport error: " + e.Err.Error()
}

func (e *TransportError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// transportSubstrings covers SDK-wrapped errors where errors.Is/As doesn't
// reach the root cause. Keep lowercase; we lowercase the error string too.
var transportSubstrings = []string{
	"connection refused",
	"connection reset",
	"broken pipe",
	"no such host",
	"i/o timeout",
	"eof",
	"connection closed",
	"client is closing",
	"tls handshake",
}

var protocolSubstrings = []string{
	"unauthorized",
	"forbidden",
	"invalid params",
	"method not found",
	"jsonrpc error",
}

// ClassifyError maps an error into one of the ErrorKind buckets. Callers pass
// the context they used for the operation so we can distinguish caller-initiated
// cancellation from server-side transport issues that happen to look similar.
func ClassifyError(ctx context.Context, err error) ErrorKind {
	if err == nil {
		return ""
	}

	if ctx != nil && ctx.Err() != nil {
		return ErrKindCanceled
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrKindCanceled
	}

	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return ErrKindTransport
	}

	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Timeout() {
		return ErrKindTransport
	}

	var netErr *net.OpError
	if errors.As(err, &netErr) {
		return ErrKindTransport
	}

	msg := strings.ToLower(err.Error())
	for _, s := range transportSubstrings {
		if strings.Contains(msg, s) {
			return ErrKindTransport
		}
	}
	for _, s := range protocolSubstrings {
		if strings.Contains(msg, s) {
			return ErrKindProtocol
		}
	}

	return ErrKindProtocol
}
