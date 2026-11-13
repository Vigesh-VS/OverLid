//! Google Gemini CLI: shipped disabled as "coming soon".
//!
//! There's no documented, reliable source for Gemini CLI quota yet, and
//! Overlid never shows guessed numbers. Detection still works so the UI can
//! say whether the CLI is signed in.

use std::time::Duration;

use super::{BoxFuture, Detection, ProviderError, UsageProvider, UsageSnapshot};

pub struct GeminiProvider;

impl UsageProvider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn display_name(&self) -> &'static str {
        "Gemini"
    }

    fn sign_in_hint(&self) -> &'static str {
        "run `gemini` in a terminal and sign in with Google"
    }

    fn available(&self) -> bool {
        false
    }

    fn detect(&self) -> Detection {
        let signed_in = dirs::home_dir().is_some_and(|h| h.join(".gemini").join("oauth_creds.json").is_file());
        Detection {
            found: false,
            detail: Some(if signed_in {
                "Gemini CLI sign-in found, but usage isn't available yet.".into()
            } else {
                "Gemini usage is coming soon.".into()
            }),
        }
    }

    fn min_interval(&self) -> Duration {
        Duration::from_secs(600)
    }

    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>> {
        Box::pin(async { Err(ProviderError::Parse("Gemini usage is coming soon".into())) })
    }
}
