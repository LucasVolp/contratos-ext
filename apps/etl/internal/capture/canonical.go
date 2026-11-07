// Package capture fetches public source responses and stores them raw, with
// content-addressed deduplication and an audit of every request.
package capture

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"slices"
	"strings"
)

// Canonicalize re-encodes a JSON document with sorted object keys, numbers kept
// verbatim and no HTML escaping, and returns it with its lowercase hex SHA-256.
// Equal documents with different key order or whitespace get the same hash.
func Canonicalize(body []byte) ([]byte, string, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, "", fmt.Errorf("response is not valid JSON: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, "", fmt.Errorf("response has data after the JSON document")
	}
	if containsNUL(value) {
		return nil, "", fmt.Errorf("response contains a NUL character, which PostgreSQL jsonb cannot store")
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, "", err
	}
	canonical := bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
	sum := sha256.Sum256(canonical)
	return canonical, hex.EncodeToString(sum[:]), nil
}

// containsNUL reports whether any decoded string or object key holds U+0000.
func containsNUL(value any) bool {
	switch v := value.(type) {
	case string:
		return strings.ContainsRune(v, 0)
	case []any:
		return slices.ContainsFunc(v, containsNUL)
	case map[string]any:
		for key, item := range v {
			if strings.ContainsRune(key, 0) || containsNUL(item) {
				return true
			}
		}
	}
	return false
}

// Request identifies one source request.
type Request struct {
	Resource string     // stable resource name, e.g. contract_commitments
	Path     string     // URL path on the source host
	Query    url.Values // optional query parameters
}

// Key is the canonical request identity: the path plus sorted query parameters.
func (r Request) Key() string {
	if len(r.Query) == 0 {
		return r.Path
	}
	return r.Path + "?" + r.Query.Encode()
}
