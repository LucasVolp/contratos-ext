package etl

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const RequiredMigration = "202611050001_financial_foundation"
const Version = "0.1.0"
const Source = "TRANSPARENCY_PORTAL"

type Options struct {
	File      string
	Date      time.Time
	ScopeType string
	Codes     []string
	Trigger   string
}

func (o Options) Validate() error {
	if o.File == "" || o.Date.IsZero() {
		return fmt.Errorf("file and reference date are required")
	}
	width := 0
	switch o.ScopeType {
	case "MANAGEMENT":
		width = 5
	case "MANAGEMENT_UNIT":
		width = 6
	default:
		return fmt.Errorf("scope must be MANAGEMENT or MANAGEMENT_UNIT")
	}
	if len(o.Codes) == 0 {
		return fmt.Errorf("at least one scope code is required")
	}
	pattern := regexp.MustCompile(fmt.Sprintf(`^[0-9]{%d}$`, width))
	for _, code := range o.Codes {
		if !pattern.MatchString(code) {
			return fmt.Errorf("invalid %s scope code %q", o.ScopeType, code)
		}
	}
	if o.Trigger != "MANUAL" && o.Trigger != "SCHEDULED" {
		return fmt.Errorf("trigger must be MANUAL or SCHEDULED")
	}
	return nil
}

func (o Options) selected(management, unit string) bool {
	value := management
	if o.ScopeType == "MANAGEMENT_UNIT" {
		value = unit
	}
	for _, code := range o.Codes {
		if code == value {
			return true
		}
	}
	return false
}

var documentPattern = regexp.MustCompile(`^([0-9]{6})([0-9]{5})([0-9]{4})[A-Z]{2}[0-9]+$`)

func documentIdentity(code string) (unit, management, year string, err error) {
	parts := documentPattern.FindStringSubmatch(code)
	if parts == nil {
		return "", "", "", fmt.Errorf("expected full source document code, got %q", code)
	}
	return parts[1], parts[2], parts[3], nil
}

func NormalizeCodes(value string) []string {
	unique := map[string]bool{}
	for _, code := range strings.Split(value, ",") {
		unique[strings.TrimSpace(code)] = true
	}
	codes := make([]string, 0, len(unique))
	for code := range unique {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes
}
