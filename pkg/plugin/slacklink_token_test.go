package plugin

import "testing"

func TestSlackBridgeTokenRoundTrip(t *testing.T) {
	const secret = "test-secret-at-least-16"
	tok, err := signSlackBridgeToken(secret, "T123", "U456", 1)
	if err != nil {
		t.Fatal(err)
	}
	tid, sid, oid, ok := verifySlackBridgeToken(secret, tok)
	if !ok || tid != "T123" || sid != "U456" || oid != 1 {
		t.Fatalf("verify failed: ok=%v tid=%q sid=%q oid=%d", ok, tid, sid, oid)
	}
}

func TestSlackBridgeTokenWrongSecret(t *testing.T) {
	tok, err := signSlackBridgeToken("a", "T", "U", 1)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, ok := verifySlackBridgeToken("b", tok)
	if ok {
		t.Fatal("expected verify failure")
	}
}
