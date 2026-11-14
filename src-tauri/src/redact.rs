//! Masks anything that looks like a credential before it reaches a log line
//! or crash message. Every log record goes through [`redact`].

/// Known token prefixes (OpenAI/Anthropic keys, GitHub tokens, Google OAuth).
const PREFIXES: [&str; 9] = ["sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "ya29.", "xoxb-"];

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | '+' | '=')
}

/// A JWT: three base64url parts, the first starting with "eyJ".
fn looks_like_jwt(word: &str) -> bool {
    let parts: Vec<&str> = word.split('.').collect();
    parts.len() == 3 && parts[0].starts_with("eyJ") && parts.iter().all(|p| p.len() >= 8)
}

/// True if a single word (no whitespace) looks like a secret.
pub fn looks_secret(word: &str) -> bool {
    let w = word.trim_matches(|c: char| !is_token_char(c));
    if w.len() < 12 {
        return false;
    }
    PREFIXES.iter().any(|p| w.starts_with(p) && w.len() > p.len() + 8) || looks_like_jwt(w)
}

/// Copy `word` into `out`, masking each piece between separators such as
/// `=`, `:` or quotes that looks like a token (`key=sk-…`, `"token":"ghp_…"`).
fn mask_segments(word: &str, out: &mut String) {
    let is_sep = |c: char| matches!(c, '=' | ':' | ',' | ';' | '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>');
    let mut rest = word;
    while !rest.is_empty() {
        let end = rest.find(is_sep).unwrap_or(rest.len());
        let (segment, after) = rest.split_at(end);
        // A trailing "=" or "==" is base64 padding, part of the token.
        let pad = after.len() - after.trim_start_matches('=').len();
        let pad = if after[pad..].chars().next().is_none_or(is_sep) { pad } else { 0 };
        if looks_secret(segment) {
            out.push_str("[REDACTED]");
            rest = &after[pad..];
        } else {
            out.push_str(segment);
            rest = after;
        }
        if let Some(c) = rest.chars().next().filter(|c| is_sep(*c)) {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
}

/// Mask secrets in a message. "Bearer <x>" and "token <x>" always mask the
/// next word; other words are masked if they look like a known token.
pub fn redact(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let mut mask_next = false;
    for part in message.split_inclusive(char::is_whitespace) {
        let word = part.trim_end();
        let tail = &part[word.len()..];
        let lower = word.to_ascii_lowercase();
        let keyword = lower == "bearer" || lower == "token" || lower == "basic";
        // "Authorization: Bearer <x>": keep the scheme, mask what follows it.
        if mask_next && !word.is_empty() && !keyword {
            out.push_str("[REDACTED]");
            out.push_str(tail);
            mask_next = false;
            continue;
        }
        if keyword || lower == "authorization:" {
            mask_next = true;
        }
        mask_segments(word, &mut out);
        out.push_str(tail);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_sample_tokens() {
        let samples = [
            "Authorization: Bearer abc.def.ghi-123456789",
            "key=sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA",
            "using ghp_0123456789abcdefABCDEF0123456789",
            "gho_16C7e42F292c6912E7710c838347Ae178B4a",
            "google ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxx",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM",
            "token deadbeefcafebabe0123",
        ];
        for s in samples {
            let r = redact(s);
            assert!(r.contains("[REDACTED]"), "not masked: {s} -> {r}");
            for word in s.split_whitespace().skip(1) {
                if word.len() > 12 {
                    assert!(!r.contains(word), "leaked {word} in {r}");
                }
            }
        }
    }

    #[test]
    fn leaves_normal_text_alone() {
        let s = "usage fetch failed: HTTP 401 for claude (auth failed)";
        assert_eq!(redact(s), s);
        assert_eq!(redact("Desk-sk-ish words"), "Desk-sk-ish words");
    }
}
