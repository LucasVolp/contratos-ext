package etl

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const RequiredMigration = "202611050001_financial_foundation"
const SourceCompatibilityMigration = "202611070001_financial_source_compatibility"
const MonthlyHierarchyMigration = "202611070002_financial_optional_monthly_hierarchy"
const ItemOccurrenceMigration = "202611070003_financial_item_occurrences"
const DownloadMigration = "202611050002_financial_download_control"
const Version = "0.3.0"
const Source = "TRANSPARENCY_PORTAL"
const DailyExpenses = "DAILY_EXPENSES"
const MonthlyExecution = "MONTHLY_EXECUTION"
const AnnualBudget = "ANNUAL_BUDGET"

type Options struct {
	File      string
	Date      time.Time
	ScopeType string
	Codes     []string
	Trigger   string
	Dataset   string
	Download  *DownloadOptions
}

func (o Options) dataset() string {
	if o.Dataset == "" {
		return DailyExpenses
	}
	return o.Dataset
}

func (o Options) period() (time.Time, time.Time) {
	switch o.dataset() {
	case AnnualBudget:
		return o.Date, o.Date.AddDate(1, 0, -1)
	case MonthlyExecution:
		return o.Date, o.Date.AddDate(0, 1, -1)
	default:
		return o.Date, o.Date
	}
}

func (o Options) Validate() error {
	if (o.File == "" && o.Download == nil) || o.Date.IsZero() {
		return fmt.Errorf("file or download configuration and reference date are required")
	}
	if o.File != "" && o.Download != nil {
		return fmt.Errorf("local file and automatic download are mutually exclusive")
	}
	if o.Download != nil {
		if err := o.Download.validate(); err != nil {
			return err
		}
	}
	if o.Date.Year() < 1900 || o.Date.Year() > 9999 {
		return fmt.Errorf("reference year must be between 1900 and 9999")
	}
	switch o.dataset() {
	case DailyExpenses:
	case MonthlyExecution:
		if o.Date.Day() != 1 {
			return fmt.Errorf("monthly reference date must be the first day of the month")
		}
	case AnnualBudget:
		if o.Date.Day() != 1 || o.Date.Month() != time.January {
			return fmt.Errorf("annual reference date must be January 1")
		}
	default:
		return fmt.Errorf("kind must be DAILY_EXPENSES, MONTHLY_EXECUTION or ANNUAL_BUDGET")
	}
	width := 0
	switch o.ScopeType {
	case "MANAGEMENT":
		width = 5
	case "MANAGEMENT_UNIT":
		width = 6
	case "SUBORDINATE_AGENCY":
		width = 5
	default:
		return fmt.Errorf("scope must be MANAGEMENT, MANAGEMENT_UNIT or SUBORDINATE_AGENCY")
	}
	if (o.dataset() == AnnualBudget) != (o.ScopeType == "SUBORDINATE_AGENCY") {
		return fmt.Errorf("ANNUAL_BUDGET requires SUBORDINATE_AGENCY scope; expense imports require MANAGEMENT or MANAGEMENT_UNIT")
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
