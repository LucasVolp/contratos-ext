package main

import (
	"context"
	"strings"
	"testing"
)

func TestInputValidationRunsBeforeConnecting(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	for _, sample := range []struct {
		args    []string
		message string
	}{
		{[]string{"-file", "daily.zip", "-date", "2026-02-30", "-codes", "26421"}, "date must"},
		{[]string{"-file", "daily.zip", "-date", "2026-09-30"}, "scope code"},
		{[]string{"-file", "daily.zip", "-date", "2026-09-30", "-codes", "26421"}, "DATABASE_URL is required"},
	} {
		err := execute(context.Background(), sample.args)
		if err == nil || !strings.Contains(err.Error(), sample.message) {
			t.Fatalf("unexpected validation: %v", err)
		}
	}
}
