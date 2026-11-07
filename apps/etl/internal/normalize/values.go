// Package normalize turns raw public source captures into typed rows.
package normalize

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	brazilianGrouped = regexp.MustCompile(`^-?\d{1,3}(\.\d{3})+(,\d+)?$`)
	brazilianPlain   = regexp.MustCompile(`^-?\d+(,\d+)?$`)
	dotDecimal       = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
	nonDigits        = regexp.MustCompile(`\D`)
)

// Money parses a Brazilian-formatted amount ("54.793,53") or a JSON number into
// plain decimal text without floating point. Null and blank give nil.
func Money(v any) (*string, error) {
	switch value := v.(type) {
	case nil:
		return nil, nil
	case json.Number:
		return checked(string(value), dotDecimal)
	case string:
		s := strings.TrimSpace(value)
		if s == "" {
			return nil, nil
		}
		if !brazilianGrouped.MatchString(s) && !brazilianPlain.MatchString(s) {
			return nil, fmt.Errorf("invalid amount %q", value)
		}
		s = strings.ReplaceAll(strings.ReplaceAll(s, ".", ""), ",", ".")
		return &s, nil
	}
	return nil, fmt.Errorf("invalid amount %v", v)
}

// Decimal parses a dot-decimal string ("750.625") or JSON number. Null and blank
// give nil.
func Decimal(v any) (*string, error) {
	switch value := v.(type) {
	case nil:
		return nil, nil
	case json.Number:
		return checked(string(value), dotDecimal)
	case string:
		s := strings.TrimSpace(value)
		if s == "" {
			return nil, nil
		}
		return checked(s, dotDecimal)
	}
	return nil, fmt.Errorf("invalid decimal %v", v)
}

func checked(s string, pattern *regexp.Regexp) (*string, error) {
	if !pattern.MatchString(s) {
		return nil, fmt.Errorf("invalid decimal %q", s)
	}
	return &s, nil
}

// Date parses "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS[.ffffff]" or an object with a
// string "date" field. It returns (nil, true) for null or blank input and
// (nil, false) for anything unparsable.
func Date(v any) (*time.Time, bool) {
	switch value := v.(type) {
	case nil:
		return nil, true
	case map[string]any:
		inner, ok := value["date"].(string)
		if !ok {
			return nil, false
		}
		return Date(inner)
	case string:
		s := strings.TrimSpace(value)
		if s == "" {
			return nil, true
		}
		if len(s) > 10 && s[10] != ' ' && s[10] != 'T' {
			return nil, false
		}
		day, err := time.Parse(time.DateOnly, s[:min(len(s), 10)])
		if err != nil {
			return nil, false
		}
		return &day, true
	}
	return nil, false
}

// Digits keeps only the digits of s.
func Digits(s string) string {
	return nonDigits.ReplaceAllString(s, "")
}

// Integer parses a JSON number or digit string. Null and blank give nil.
func Integer(v any) (*int64, error) {
	var s string
	switch value := v.(type) {
	case nil:
		return nil, nil
	case json.Number:
		s = string(value)
	case string:
		s = strings.TrimSpace(value)
		if s == "" {
			return nil, nil
		}
	default:
		return nil, fmt.Errorf("invalid integer %v", v)
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid integer %q", s)
	}
	return &n, nil
}
