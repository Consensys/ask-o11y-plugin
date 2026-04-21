package oauth

import (
	"context"

	"consensys-asko11y-app/pkg/mcp"
)

// WithUserID is a re-export so callers don't have to also depend on pkg/mcp.
func WithUserID(ctx context.Context, userID int64) context.Context {
	return mcp.WithUserID(ctx, userID)
}

// UserIDFromContext is a re-export of mcp.UserIDFromContext for symmetry.
func UserIDFromContext(ctx context.Context) (int64, bool) {
	return mcp.UserIDFromContext(ctx)
}
