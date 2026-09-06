package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

/*
Errors on the wire.

Doc 02 §8 fixes the shape: a stable machine `code`, a human `message`, and an
optional `details` object. The code is the contract; clients switch on it and
never on the text.

The server carries English and French for its own small fixed set of codes and
translates nothing else, because it does not know what the data is. That is the
client's job, and the web app already has the apparatus for it.
*/

type apiError struct {
	status  int
	code    string
	details map[string]any
}

func (e apiError) Error() string { return e.code }

// The whole catalogue. Doc 02 §8 lists the codes for the first release; the
// sync ones are here already so that the two halves of the API cannot drift
// into two different vocabularies.
var errorMessages = map[string]struct{ en, fr string }{
	"unauthorized": {
		"Authentication is required.",
		"Une authentification est nécessaire.",
	},
	"invalid_credentials": {
		"That address and password do not match an account.",
		"Cette adresse et ce mot de passe ne correspondent à aucun compte.",
	},
	"email_taken": {
		"That address already has an account on this instance.",
		"Cette adresse a déjà un compte sur cette instance.",
	},
	"invalid_email": {
		"That does not look like an email address.",
		"Cela ne ressemble pas à une adresse e-mail.",
	},
	"handle_taken": {
		"That handle is already in use on this instance.",
		"Cet identifiant est déjà utilisé sur cette instance.",
	},
	"email_not_verified": {
		"Confirm your address from the message we sent you. The account is disabled until you do.",
		"Confirmez votre adresse depuis le message que nous vous avons envoyé. Le compte est désactivé jusque-là.",
	},
	"invalid_verification": {
		"That confirmation link is not valid. It may already have been used.",
		"Ce lien de confirmation n'est pas valide. Il a peut-être déjà servi.",
	},
	"verification_expired": {
		"That confirmation link has expired. Ask for a new one.",
		"Ce lien de confirmation a expiré. Demandez-en un nouveau.",
	},
	"server_busy": {
		"The server is busy checking other passwords. Try again in a moment.",
		"Le serveur est occupé à vérifier d'autres mots de passe. Réessayez dans un instant.",
	},
	"registration_closed": {
		"This instance is not accepting new accounts.",
		"Cette instance n'accepte pas de nouveaux comptes.",
	},
	"invalid_recovery_code": {
		"That recovery code is not valid for this account.",
		"Ce code de récupération n'est pas valide pour ce compte.",
	},
	"invalid_handle": {
		"A handle is 3 to 32 characters, using letters, digits, dot, dash or underscore.",
		"Un identifiant fait 3 à 32 caractères : lettres, chiffres, point, tiret ou soulignement.",
	},
	"weak_password": {
		"A password is at least 12 characters, and cannot contain your pseudonym or your address.",
		"Un mot de passe fait au moins 12 caractères, et ne peut pas contenir votre pseudo ni votre adresse.",
	},
	"cursor_too_old": {
		"That cursor predates the tombstone retention window; a full resynchronisation is required.",
		"Ce curseur est antérieur à la fenêtre de rétention ; une resynchronisation complète est nécessaire.",
	},
	"batch_too_large": {
		"That batch exceeds the published limit.",
		"Ce lot dépasse la limite publiée.",
	},
	"record_too_large": {
		"That record exceeds the published size limit.",
		"Cet enregistrement dépasse la taille limite publiée.",
	},
	"malformed_record": {
		"The request body could not be read.",
		"Le corps de la requête n'a pas pu être lu.",
	},
	"not_found": {
		"There is nothing here.",
		"Il n'y a rien ici.",
	},
	"method_not_allowed": {
		"That method is not allowed on this endpoint.",
		"Cette méthode n'est pas autorisée sur ce point d'entrée.",
	},
	"rate_limited": {
		"Too many attempts. Wait a little and try again.",
		"Trop de tentatives. Patientez un instant puis réessayez.",
	},
	"server_error": {
		"Something went wrong on the server.",
		"Une erreur est survenue côté serveur.",
	},
}

/*
prefersFrench reads Accept-Language.

A deliberately small parser: there are two languages, so the only question is
whether French outranks English, and the q-values are the only part of the
header that can answer it. Anything unrecognised leaves English, which is the
fallback everywhere else in the API.
*/
func prefersFrench(header string) bool {
	best := struct {
		fr, en float64
	}{}
	for _, part := range strings.Split(header, ",") {
		tag, quality := part, 1.0
		if semi := strings.Index(part, ";"); semi >= 0 {
			tag = part[:semi]
			if q, err := strconv.ParseFloat(strings.TrimPrefix(strings.TrimSpace(part[semi+1:]), "q="), 64); err == nil {
				quality = q
			}
		}
		tag = strings.ToLower(strings.TrimSpace(tag))
		switch {
		case tag == "fr" || strings.HasPrefix(tag, "fr-"):
			best.fr = max(best.fr, quality)
		case tag == "en" || strings.HasPrefix(tag, "en-"):
			best.en = max(best.en, quality)
		case tag == "*":
			best.en = max(best.en, quality)
		}
	}
	return best.fr > best.en
}

func writeError(w http.ResponseWriter, r *http.Request, err apiError) {
	message, known := errorMessages[err.code]
	if !known {
		message = errorMessages["server_error"]
	}

	text := message.en
	if prefersFrench(r.Header.Get("Accept-Language")) {
		text = message.fr
	}

	body := map[string]any{
		"error": map[string]any{
			"code":    err.code,
			"message": text,
		},
	}
	if err.details != nil {
		body["error"].(map[string]any)["details"] = err.details
	}

	writeJSON(w, err.status, body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// Nothing this API returns should ever be cached, by a browser or by the
	// reverse proxy: every response is either a credential or account state.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}
