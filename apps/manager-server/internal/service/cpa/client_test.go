package cpa

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestFetchAPIKeys(t *testing.T) {
	expectedToken := "test-mgmt-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v0/management/api-keys" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+expectedToken {
			t.Errorf("unexpected auth header: %s", auth)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"api-keys": []string{
				"  key-1  ",
				"",
				"key-2",
				"key-1",
				"   ",
				"key-3",
			},
		})
	}))
	defer server.Close()

	ctx := context.Background()
	keys, err := FetchAPIKeys(ctx, server.URL, expectedToken)
	if err != nil {
		t.Fatalf("FetchAPIKeys failed: %v", err)
	}

	expected := []string{"key-1", "key-2", "key-3"}
	if !reflect.DeepEqual(keys, expected) {
		t.Errorf("expected keys %v, got %v", expected, keys)
	}
}

func TestFetchModelsWithAPIKey(t *testing.T) {
	expectedToken := "client-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+expectedToken {
			t.Errorf("unexpected auth header: %s", auth)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "gpt-b"},
				{"id": " gpt-a "},
				{"id": "gpt-a"},
				{"id": ""},
			},
		})
	}))
	defer server.Close()

	ctx := context.Background()
	models, err := FetchModels(ctx, server.URL, expectedToken)
	if err != nil {
		t.Fatalf("FetchModels failed: %v", err)
	}

	expected := []string{"gpt-a", "gpt-b"}
	if !reflect.DeepEqual(models, expected) {
		t.Errorf("expected models %v, got %v", expected, models)
	}
}

func TestFetchModelsAnonymous(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("expected no authorization header, got: %s", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "anon-model-2"},
				{"id": "anon-model-1"},
			},
		})
	}))
	defer server.Close()

	ctx := context.Background()
	models, err := FetchModels(ctx, server.URL, "")
	if err != nil {
		t.Fatalf("FetchModels failed: %v", err)
	}

	expected := []string{"anon-model-1", "anon-model-2"}
	if !reflect.DeepEqual(models, expected) {
		t.Errorf("expected models %v, got %v", expected, models)
	}
}
