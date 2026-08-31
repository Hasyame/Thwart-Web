package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

/*
Secrets: how passwords and recovery codes are hashed, and how device tokens are
made and looked up.

Two different jobs, deliberately handled differently.

A **password or a recovery code** is chosen or written down by a person, so it
has to survive an offline attack on a stolen database. Those go through
Argon2id, which is slow and memory-hungry on purpose.

A **device token** is 256 bits from the system CSPRNG. There is nothing to
guess, so hashing it slowly buys nothing and would put an Argon2 computation on
the path of every single request. It is stored as a SHA-256 so that a database
dump still yields nothing replayable.
*/

// Argon2id parameters.
//
// The second of the two configurations RFC 9106 recommends: 64 MiB, one pass,
// four lanes. Time is where the cost should go, but memory is what makes a GPU
// attack expensive, and a login is rate-limited to a handful per minute so the
// server never runs many of these at once.
//
// Doc 05 says to tune these on the actual VPS rather than on a desktop, because
// memory is the parameter that will surprise you on a small box.
const (
	argonTime    = 1
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

// hashSecret returns an encoded Argon2id hash, carrying its own parameters so
// they can be raised later without invalidating every existing hash.
func hashSecret(secret string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}
	key := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

var errBadHash = errors.New("malformed hash")

// verifySecret checks a secret against an encoded hash, using the parameters
// recorded in the hash rather than the current constants, so that raising the
// cost does not lock everybody out.
func verifySecret(secret, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errBadHash
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, errBadHash
	}
	if version != argon2.Version {
		return false, errBadHash
	}

	var memory uint32
	var time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, errBadHash
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, errBadHash
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, errBadHash
	}

	got := argon2.IDKey([]byte(secret), salt, time, memory, threads, uint32(len(want)))
	// Constant time: a byte-by-byte comparison leaks how much of the hash
	// matched, which over many attempts leaks the hash.
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// --- device tokens ---------------------------------------------------------

const tokenPrefix = "tw_live_"

// newDeviceToken returns the token to hand to the client, and the hash to store.
//
// The prefix is there so that a token found in a log or a paste is instantly
// recognisable as a credential worth revoking, which an anonymous blob of
// base64 is not.
func newDeviceToken() (token string, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("read token: %w", err)
	}
	token = tokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// --- recovery codes --------------------------------------------------------

/*
The alphabet excludes I, L, O and U.

Crockford's set: the first three because they are read as 1 and 0, and U because
excluding it keeps the generator from ever producing an unfortunate word. This
code is meant to be written on paper and typed back in months later, possibly by
somebody reading their own handwriting, so every character that can be
mistranscribed is a support request.
*/
const recoveryAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const (
	recoveryGroups     = 4
	recoveryGroupSize  = 4
	recoveryCharacters = recoveryGroups * recoveryGroupSize
)

/*
newRecoveryCode returns a code of the form TW-4KX9-2M7P-QR31-8VNE.

Sixteen characters from a 32-symbol alphabet is 80 bits of entropy. Doc 02
originally said 128; 80 is the deliberate amendment, because this is the one
secret in the system a person has to copy by hand, and the length at which they
stop doing that accurately is a real failure mode.

Eighty bits is not a compromise on safety. Guessing one means defeating Argon2id
at 64 MiB per attempt, through a rate limiter that allows five attempts an hour:
at that rate the expected search is longer than the age of the universe by many
orders of magnitude. The binding constraint is the rate limiter, not the code.
*/
func newRecoveryCode() (string, error) {
	buf := make([]byte, recoveryCharacters)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read recovery code: %w", err)
	}

	var b strings.Builder
	b.WriteString("TW")
	for i, v := range buf {
		if i%recoveryGroupSize == 0 {
			b.WriteByte('-')
		}
		// rand.Read gives uniform bytes; 256 is not a multiple of 32, but it is
		// 8 times it exactly, so a plain modulo is uniform here.
		b.WriteByte(recoveryAlphabet[int(v)%len(recoveryAlphabet)])
	}
	return b.String(), nil
}

/*
normaliseRecoveryCode makes a typed code comparable with a generated one.

People will type it in lower case, leave the dashes out, or add spaces. They
will also type O for 0 and I or l for 1, which is exactly why those characters
are not in the alphabet: rather than reject the attempt, the ones that were
excluded are folded onto the ones they are mistaken for.
*/
func normaliseRecoveryCode(input string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(input)) {
		switch r {
		case '-', ' ', '\t':
			continue
		case 'O':
			b.WriteRune('0')
		case 'I', 'L':
			b.WriteRune('1')
		case 'U':
			b.WriteRune('V')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}
