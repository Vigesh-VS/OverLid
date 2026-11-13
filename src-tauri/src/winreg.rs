//! Tiny read-only registry helpers (HKCU / HKLM values and change waits).

use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_DWORD,
    RRF_RT_REG_SZ, RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW,
};
use windows::core::HSTRING;

#[derive(Debug, Clone, Copy)]
pub enum Root {
    CurrentUser,
    LocalMachine,
}

fn hkey(root: Root) -> HKEY {
    match root {
        Root::CurrentUser => HKEY_CURRENT_USER,
        Root::LocalMachine => HKEY_LOCAL_MACHINE,
    }
}

pub fn read_string(root: Root, subkey: &str, value: &str) -> Option<String> {
    let (subkey, value) = (HSTRING::from(subkey), HSTRING::from(value));
    let mut buf = [0u16; 512];
    let mut len = u32::try_from(size_of_val(&buf)).ok()?;
    // SAFETY: buffer and length describe valid writable memory.
    let status = unsafe {
        RegGetValueW(
            hkey(root),
            &subkey,
            &value,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut len),
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let chars = (len as usize / 2).min(buf.len());
    let text = String::from_utf16_lossy(&buf[..chars]);
    Some(text.trim_end_matches('\0').to_owned())
}

pub fn read_dword(root: Root, subkey: &str, value: &str) -> Option<u32> {
    let (subkey, value) = (HSTRING::from(subkey), HSTRING::from(value));
    let mut data = 0u32;
    let mut len = size_of::<u32>() as u32;
    // SAFETY: data/len describe a valid u32.
    let status = unsafe {
        RegGetValueW(
            hkey(root),
            &subkey,
            &value,
            RRF_RT_REG_DWORD,
            None,
            Some((&raw mut data).cast()),
            Some(&mut len),
        )
    };
    (status == ERROR_SUCCESS).then_some(data)
}

/// Block until a value under `subkey` changes. Returns false if the key
/// can't be watched (callers should then fall back to polling).
pub fn wait_for_change(root: Root, subkey: &str) -> bool {
    let subkey = HSTRING::from(subkey);
    let mut key = HKEY::default();
    // SAFETY: out-parameter is a valid HKEY slot; the key is closed below.
    unsafe {
        if RegOpenKeyExW(hkey(root), &subkey, None, KEY_NOTIFY, &mut key) != ERROR_SUCCESS {
            return false;
        }
        let status = RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, None, false);
        let _ = RegCloseKey(key);
        status == ERROR_SUCCESS
    }
}
