package etl

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

var decimalPattern = regexp.MustCompile(`^[+-]?[0-9]+(?:\.[0-9]+)?$`)
var brazilianPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+),[0-9]+$`)

// Decimal keeps exact source precision; it never converts money to float64.
func Decimal(value string, precision, scale int) (any, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if strings.Contains(value, ",") {
		if !brazilianPattern.MatchString(value) {
			return nil, fmt.Errorf("invalid decimal %q", value)
		}
		value = strings.ReplaceAll(value, ".", "")
		value = strings.Replace(value, ",", ".", 1)
	}
	if !decimalPattern.MatchString(value) {
		return nil, fmt.Errorf("invalid decimal %q", value)
	}
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimLeft(value, "+-")
	parts := strings.SplitN(value, ".", 2)
	integer := strings.TrimLeft(parts[0], "0")
	if integer == "" {
		integer = "0"
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = strings.TrimRight(parts[1], "0")
	}
	if len(integer) > precision-scale || len(fraction) > scale {
		return nil, fmt.Errorf("decimal exceeds numeric(%d,%d): %q", precision, scale, value)
	}
	result := integer
	if fraction != "" {
		result += "." + fraction
	}
	if negative && result != "0" {
		result = "-" + result
	}
	return result, nil
}

func addMoney(a, b any) (any, error) {
	if a == nil {
		return b, nil
	}
	if b == nil {
		return a, nil
	}
	x, _ := new(big.Rat).SetString(a.(string))
	y, _ := new(big.Rat).SetString(b.(string))
	return Decimal(new(big.Rat).Add(x, y).FloatString(6), 24, 6)
}
