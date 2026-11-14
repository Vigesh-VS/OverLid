//! A string that holds a credential. It can't be printed, logged or
//! serialised by accident, and its bytes are wiped when it's dropped.

use std::fmt;

pub struct Secret(String);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// The raw value, for the one place it's needed (an auth header).
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        // SAFETY: overwriting with zeros keeps the bytes valid UTF-8 (NUL is
        // a valid char); volatile writes stop the compiler optimising this out.
        unsafe {
            for b in self.0.as_bytes_mut() {
                std::ptr::write_volatile(b, 0);
            }
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_formats_its_value() {
        let s = Secret::new("sk-ant-very-secret".into());
        assert_eq!(format!("{s}"), "[redacted]");
        assert!(!format!("{s:?}").contains("very-secret"));
        assert_eq!(s.expose(), "sk-ant-very-secret");
    }
}
