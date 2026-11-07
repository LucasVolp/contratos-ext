package normalize

import (
	"encoding/json"
	"testing"
	"time"
)

func text(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

func TestMoney(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{"54.793,53", "54793.53"},
		{"0,00", "0.00"},
		{"12.345.678.901.234,56", "12345678901234.56"},
		{"1000", "1000"},
		{"-1.234,50", "-1234.50"},
		{json.Number("6100.5"), "6100.5"},
		{"", "<nil>"},
		{nil, "<nil>"},
	}
	for _, c := range cases {
		got, err := Money(c.in)
		if err != nil || text(got) != c.want {
			t.Fatalf("Money(%#v) = %s, %v; want %s", c.in, text(got), err, c.want)
		}
	}
	for _, bad := range []any{"abc", "1,2,3", "1.23", true} {
		if _, err := Money(bad); err == nil {
			t.Fatalf("Money(%#v) accepted", bad)
		}
	}
}

func TestDecimal(t *testing.T) {
	for in, want := range map[string]string{"750.625": "750.625", "600.5": "600.5", "12": "12", "": "<nil>"} {
		got, err := Decimal(in)
		if err != nil || text(got) != want {
			t.Fatalf("Decimal(%q) = %s, %v", in, text(got), err)
		}
	}
	if got, err := Decimal(json.Number("3.5")); err != nil || text(got) != "3.5" {
		t.Fatalf("Decimal(json.Number) = %s, %v", text(got), err)
	}
	if _, err := Decimal("7,5"); err == nil {
		t.Fatal("Decimal accepted a comma")
	}
}

func TestDate(t *testing.T) {
	day := func(v any) string {
		d, ok := Date(v)
		if d == nil {
			if ok {
				return "<nil>"
			}
			return "<bad>"
		}
		return d.Format(time.DateOnly)
	}
	cases := map[string]any{
		"2026-11-04":  "2026-11-04",
		"2021-04-19":  "2021-04-19 15:39:57.000000",
		"2021-04-19 ": map[string]any{"date": "2021-04-19 15:39:57.000000", "timezone_type": json.Number("3")},
		"2020-01-02":  "2020-01-02 10:00:00",
	}
	for want, in := range cases {
		if got := day(in); got != want[:10] {
			t.Fatalf("Date(%#v) = %s, want %s", in, got, want[:10])
		}
	}
	for _, blank := range []any{"", nil} {
		if got := day(blank); got != "<nil>" {
			t.Fatalf("Date(%#v) = %s, want <nil>", blank, got)
		}
	}
	for _, bad := range []any{"0000-00-00", "31/12/2020", map[string]any{"date": 5}} {
		if got := day(bad); got != "<bad>" {
			t.Fatalf("Date(%#v) = %s, want <bad>", bad, got)
		}
	}
}

func TestDigitsAndInteger(t *testing.T) {
	if got := Digits("59.339.070/0001-11"); got != "59339070000111" {
		t.Fatalf("Digits = %s", got)
	}
	if got, err := Integer(json.Number("12")); err != nil || got == nil || *got != 12 {
		t.Fatalf("Integer(json.Number) = %v, %v", got, err)
	}
	if got, err := Integer("7"); err != nil || got == nil || *got != 7 {
		t.Fatalf("Integer(string) = %v, %v", got, err)
	}
	if got, err := Integer(nil); err != nil || got != nil {
		t.Fatalf("Integer(nil) = %v, %v", got, err)
	}
	if _, err := Integer("x"); err == nil {
		t.Fatal("Integer accepted x")
	}
}
