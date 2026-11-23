//! Durable evidence of an exchange whose predecessor may have been consumed.
//! Child of canonical_auth: descriptor anchoring and structural errors are shared.
use super::{CanonicalAuth, O_NOFOLLOW, O_NONBLOCK, RefreshLock, refused, safe_file};
use std::fs::{self, Metadata, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

const INTENT: &str = ".hive-mind-refresh-intent";
const MAGIC: &[u8; 8] = b"HIVE-R1\0";
type Version = (u64, u64, u64, i64, i64, i64, i64);

fn version(info: &Metadata) -> Version {
    (
        info.dev(),
        info.ino(),
        info.len(),
        info.mtime(),
        info.mtime_nsec(),
        info.ctime(),
        info.ctime_nsec(),
    )
}

impl CanonicalAuth {
    fn inspect_intent(&self) -> io::Result<Option<Metadata>> {
        self.assert_current()?;
        match fs::symlink_metadata(self.entry(INTENT)) {
            Ok(info) if safe_file(&info, self.owner) && info.len() == 40 => Ok(Some(info)),
            Ok(_) => Err(refused()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(refused()),
        }
    }

    fn read_intent(&self) -> io::Result<Option<([u8; 32], Version)>> {
        let Some(before) = self.inspect_intent()? else {
            return Ok(None);
        };
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(O_NOFOLLOW | O_NONBLOCK)
            .open(self.entry(INTENT))?;
        let opened = file.metadata()?;
        if !safe_file(&opened, self.owner) || version(&before) != version(&opened) {
            return Err(refused());
        }
        let mut bytes = [0; 40];
        file.read_exact(&mut bytes).map_err(|_| refused())?;
        let after = self.inspect_intent()?.ok_or_else(refused)?;
        if version(&after) != version(&opened) || bytes[..8] != *MAGIC {
            return Err(refused());
        }
        self.assert_current()?;
        Ok(Some((
            bytes[8..].try_into().map_err(|_| refused())?,
            version(&opened),
        )))
    }

    pub(crate) fn refresh_intent(&self) -> io::Result<Option<[u8; 32]>> {
        self.read_intent()
            .map(|value| value.map(|(digest, _)| digest))
    }

    // A reader observing already-published G1 may establish durability without
    // deleting the marker or taking a recursive transaction lock.
    pub(crate) fn sync_current_auth(&self) -> io::Result<()> {
        self.assert_current()?;
        let before = self.inspect_auth()?.ok_or_else(refused)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(O_NOFOLLOW | O_NONBLOCK)
            .open(self.entry("auth.json"))?;
        if version(&file.metadata()?) != version(&before) {
            return Err(refused());
        }
        file.sync_all()?;
        self.directory.sync_all()?;
        if version(&self.inspect_auth()?.ok_or_else(refused)?) != version(&before) {
            return Err(refused());
        }
        self.assert_current()
    }
}

impl RefreshLock {
    pub(crate) fn auth_bytes(&self) -> io::Result<Option<Vec<u8>>> {
        self.assert_current()?;
        self.shared.read()
    }

    pub(crate) fn refresh_intent(&self) -> io::Result<Option<[u8; 32]>> {
        self.assert_current()?;
        self.shared.refresh_intent()
    }

    pub(crate) fn begin_refresh(&self, digest: &[u8; 32]) -> io::Result<()> {
        self.assert_current()?;
        if self.shared.read_intent()?.is_some() {
            return Err(refused());
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(O_NOFOLLOW)
            .open(self.shared.entry(INTENT))?;
        file.write_all(MAGIC)?;
        file.write_all(digest)?;
        file.sync_all()?;
        self.shared.directory.sync_all()?;
        self.assert_current()?;
        let (current, current_version) = self.shared.read_intent()?.ok_or_else(refused)?;
        if current != *digest || current_version != version(&file.metadata()?) {
            return Err(refused());
        }
        // Any failed marker publication remains evidence; it is never guessed
        // stale or removed merely because no response was received.
        Ok(())
    }

    pub(crate) fn finish_refresh(&self, expected: &[u8; 32]) -> io::Result<()> {
        self.assert_current()?;
        let (digest, before) = self.shared.read_intent()?.ok_or_else(refused)?;
        if digest != *expected
            || version(&self.shared.inspect_intent()?.ok_or_else(refused)?) != before
        {
            return Err(refused());
        }
        fs::remove_file(self.shared.entry(INTENT))?;
        self.shared.directory.sync_all()?;
        self.assert_current()
    }

    pub(crate) fn sync_current_auth(&self) -> io::Result<()> {
        self.assert_current()?;
        self.shared.sync_current_auth()
    }
}
