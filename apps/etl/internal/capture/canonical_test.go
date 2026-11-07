package capture

import (
	"bytes"
	"net/url"
	"testing"
)

func TestCanonicalizeSortsKeysAndKeepsNumbers(t *testing.T) {
	a, hashA, err := Canonicalize([]byte(`{"b":1,"a":"54.793,53","n":12345678901234567890}`))
	if err != nil {
		t.Fatal(err)
	}
	b, hashB, err := Canonicalize([]byte(`{ "a": "54.793,53", "n": 12345678901234567890, "b": 1 }`))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) || hashA != hashB {
		t.Fatalf("canonical forms differ: %s vs %s", a, b)
	}
	if !bytes.Contains(a, []byte("12345678901234567890")) {
		t.Fatalf("large number lost precision: %s", a)
	}
	if len(hashA) != 64 {
		t.Fatalf("hash length = %d", len(hashA))
	}
	if bytes.HasSuffix(a, []byte("\n")) {
		t.Fatal("canonical form has trailing newline")
	}
	if c, _, _ := Canonicalize([]byte(`{"s":"<a&b>"}`)); !bytes.Contains(c, []byte("<a&b>")) {
		t.Fatalf("HTML characters were escaped: %s", c)
	}
}

func TestCanonicalizeRejectsNonJSON(t *testing.T) {
	for _, body := range []string{"<html>challenge</html>", `{"a":1} trailing`, ""} {
		if _, _, err := Canonicalize([]byte(body)); err == nil {
			t.Fatalf("accepted %q", body)
		}
	}
}

func TestCanonicalizeRejectsNULCharacters(t *testing.T) {
	// PostgreSQL jsonb cannot store U+0000; such a response must fail on its own
	// instead of aborting the whole run at the store.
	for _, body := range []string{`{"a":"x\u0000y"}`, `{"a\u0000":1}`, `[["\u0000"]]`} {
		if _, _, err := Canonicalize([]byte(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	if _, _, err := Canonicalize([]byte(`{"a":"literal \\u0000 text"}`)); err != nil {
		t.Fatalf("rejected an escaped backslash sequence: %v", err)
	}
}

func TestRequestKeySortsQuery(t *testing.T) {
	r := Request{Path: "/api/x", Query: url.Values{"b": {"2"}, "a": {"1"}}}
	if got := r.Key(); got != "/api/x?a=1&b=2" {
		t.Fatalf("key = %s", got)
	}
	if got := (Request{Path: "/api/x"}).Key(); got != "/api/x" {
		t.Fatalf("key without query = %s", got)
	}
}
