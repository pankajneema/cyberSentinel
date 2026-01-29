package config

import "os"

// Get returns the value of an env var or a fallback
func Get(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

// MustGet returns the value or panics if missing
func MustGet(key string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	panic("missing required env var: " + key)
}

