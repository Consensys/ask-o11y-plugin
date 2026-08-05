package mcp

import (
	"encoding/base64"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestImageContentBlockEncodesBinaryData(t *testing.T) {
	imageData := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

	block := imageContentBlock(&mcpsdk.ImageContent{
		Data:     imageData,
		MIMEType: "image/png",
	})

	if block.Type != "image" {
		t.Fatalf("expected image content, got %q", block.Type)
	}
	if block.MimeType != "image/png" {
		t.Fatalf("expected image/png MIME type, got %q", block.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(block.Data)
	if err != nil {
		t.Fatalf("expected base64-encoded image data, got %q: %v", block.Data, err)
	}
	if string(decoded) != string(imageData) {
		t.Fatalf("decoded image data differs: got %v, want %v", decoded, imageData)
	}
}

func TestAudioContentBlockEncodesBinaryData(t *testing.T) {
	audioData := []byte{0xff, 0xfb, 0x90, 0x64}

	block := audioContentBlock(&mcpsdk.AudioContent{
		Data:     audioData,
		MIMEType: "audio/mpeg",
	})

	if block.Type != "audio" {
		t.Fatalf("expected audio content, got %q", block.Type)
	}
	if block.MimeType != "audio/mpeg" {
		t.Fatalf("expected audio/mpeg MIME type, got %q", block.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(block.Data)
	if err != nil {
		t.Fatalf("expected base64-encoded audio data, got %q: %v", block.Data, err)
	}
	if string(decoded) != string(audioData) {
		t.Fatalf("decoded audio data differs: got %v, want %v", decoded, audioData)
	}
}
