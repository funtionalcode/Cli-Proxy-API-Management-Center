package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

const encryptedPrefix = "enc:v1:"
const adminKeyPrefix = "cpamp_"
const generatedAdminKeyLength = 32
const generatedSecretAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const adminHashIterations = 1

func GenerateAdminKey() (string, error) {
	random, err := randomAlnum(generatedAdminKeyLength)
	if err != nil {
		return "", err
	}
	return adminKeyPrefix + random, nil
}

func NewAdminCredential(adminKey string, source string) (model.AdminCredential, error) {
	adminKey = strings.TrimSpace(adminKey)
	if adminKey == "" {
		return model.AdminCredential{}, errors.New("admin key is required")
	}
	salt, err := randomBytes(16)
	if err != nil {
		return model.AdminCredential{}, err
	}
	keyHash, err := hashAdminKey(adminKey, salt, adminHashIterations)
	if err != nil {
		return model.AdminCredential{}, err
	}
	return model.AdminCredential{
		Version:     1,
		Salt:        base64.RawStdEncoding.EncodeToString(salt),
		KeyHash:     base64.RawStdEncoding.EncodeToString(keyHash),
		Iterations:  adminHashIterations,
		CreatedAtMS: time.Now().UnixMilli(),
		Source:      source,
	}, nil
}

func VerifyAdminKey(credential model.AdminCredential, adminKey string) bool {
	adminKey = strings.TrimSpace(adminKey)
	if adminKey == "" || credential.Salt == "" || credential.KeyHash == "" {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(credential.Salt)
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(credential.KeyHash)
	if err != nil {
		return false
	}
	iterations := credential.Iterations
	if iterations <= 0 {
		iterations = adminHashIterations
	}
	got, err := hashAdminKey(adminKey, salt, iterations)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func ExtractBearerToken(header string) string {
	header = strings.TrimSpace(header)
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

func LoadOrCreateDataKey(rawValue string, keyPath string) ([]byte, bool, error) {
	if strings.TrimSpace(rawValue) != "" {
		key, err := deriveDataKey(rawValue)
		return key, false, err
	}
	keyPath = strings.TrimSpace(keyPath)
	if keyPath == "" {
		return nil, false, errors.New("data key path is required")
	}
	if data, err := os.ReadFile(keyPath); err == nil {
		key, err := parseStoredDataKey(strings.TrimSpace(string(data)))
		return key, false, err
	} else if !os.IsNotExist(err) {
		return nil, false, fmt.Errorf("read data key %s: %w", keyPath, err)
	}
	key, err := randomBytes(32)
	if err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
		return nil, false, fmt.Errorf("create data key directory %s: %w", filepath.Dir(keyPath), err)
	}
	content := base64.RawStdEncoding.EncodeToString(key) + "\n"
	if err := os.WriteFile(keyPath, []byte(content), 0o600); err != nil {
		return nil, false, fmt.Errorf("write data key %s: %w", keyPath, err)
	}
	return key, true, nil
}

type Protector struct {
	key []byte
}

func NewProtector(key []byte) (*Protector, error) {
	if len(key) == 0 {
		return nil, errors.New("data key is required")
	}
	derived, err := hkdf.Key(sha256.New, key, []byte("cpa-manager-plus"), "settings-secrets-v1", 32)
	if err != nil {
		return nil, err
	}
	return &Protector{key: derived}, nil
}

func (p *Protector) ProtectString(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || IsProtected(value) {
		return value, nil
	}
	nonce, err := randomBytes(12)
	if err != nil {
		return "", err
	}
	aead, err := p.aead()
	if err != nil {
		return "", err
	}
	ciphertext := aead.Seal(nil, nonce, []byte(value), []byte("settings-secret"))
	return encryptedPrefix +
		base64.RawStdEncoding.EncodeToString(nonce) + ":" +
		base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func (p *Protector) UnprotectString(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !IsProtected(value) {
		return value, nil
	}
	payload := strings.TrimPrefix(value, encryptedPrefix)
	parts := strings.Split(payload, ":")
	if len(parts) != 2 {
		return "", errors.New("invalid encrypted secret format")
	}
	nonce, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	aead, err := p.aead()
	if err != nil {
		return "", err
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, []byte("settings-secret"))
	if err != nil {
		return "", errors.New("decrypt secret: invalid data key or corrupted ciphertext")
	}
	return string(plaintext), nil
}

func IsProtected(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), encryptedPrefix)
}

func (p *Protector) aead() (cipher.AEAD, error) {
	block, err := aes.NewCipher(p.key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func hashAdminKey(adminKey string, salt []byte, iterations int) ([]byte, error) {
	if iterations <= 1 {
		mac := hmac.New(sha256.New, salt)
		_, _ = mac.Write([]byte(adminKey))
		return mac.Sum(nil), nil
	}
	return pbkdf2.Key(sha256.New, adminKey, salt, iterations, 32)
}

func deriveDataKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("data key is required")
	}
	if key, err := parseStoredDataKey(value); err == nil {
		return key, nil
	}
	return hkdf.Key(sha256.New, []byte(value), []byte("cpa-manager-plus"), "data-key-v1", 32)
}

func parseStoredDataKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("data key is empty")
	}
	if key, err := base64.RawStdEncoding.DecodeString(value); err == nil && len(key) == 32 {
		return key, nil
	}
	if key, err := base64.StdEncoding.DecodeString(value); err == nil && len(key) == 32 {
		return key, nil
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if len([]byte(value)) == 32 {
		return []byte(value), nil
	}
	return nil, errors.New("data key must be 32 bytes or base64-encoded 32 bytes")
}

func randomBytes(size int) ([]byte, error) {
	out := make([]byte, size)
	if _, err := rand.Read(out); err != nil {
		return nil, err
	}
	return out, nil
}

func randomAlnum(length int) (string, error) {
	if length <= 0 {
		return "", errors.New("random alphanumeric length must be positive")
	}
	out := make([]byte, length)
	buf := make([]byte, length*2)
	limit := byte(len(generatedSecretAlphabet) * (256 / len(generatedSecretAlphabet)))
	for i := 0; i < length; {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, b := range buf {
			if b >= limit {
				continue
			}
			out[i] = generatedSecretAlphabet[int(b)%len(generatedSecretAlphabet)]
			i++
			if i == length {
				break
			}
		}
	}
	return string(out), nil
}

func EqualHMAC(left string, right string) bool {
	return hmac.Equal([]byte(left), []byte(right))
}
