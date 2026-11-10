// The probe generator substitutes only this source path. The lock implementation
// is the actual pinned native rollout module, not a model of its behavior.
#[path = "__NATIVE_MAINTENANCE_SOURCE__"]
mod maintenance;

use std::io::{self, Write};
use std::path::PathBuf;

fn main() {
    let config = PathBuf::from(std::env::args_os().nth(1).expect("private config"));
    let guard = match maintenance::try_acquire_rollout_maintenance_lock(&config) {
        Ok(guard) => guard,
        Err(_) => {
            println!("REFUSED");
            return;
        }
    };
    println!("{}", if guard.is_some() { "ACQUIRED" } else { "BUSY" });
    io::stdout().flush().expect("flush readiness");
    if guard.is_some() {
        let mut release = String::new();
        io::stdin().read_line(&mut release).expect("release signal");
    }
}
