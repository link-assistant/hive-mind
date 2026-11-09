fn main() {
    println!("cargo:rerun-if-changed=src/sqlite/canonical_sqlite_vfs.c");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }
    let include = std::env::var("DEP_SQLITE3_INCLUDE")
        .expect("canonical SQLite needs the checked bundled SQLite header");
    cc::Build::new()
        .file("src/sqlite/canonical_sqlite_vfs.c")
        .include(include)
        .flag_if_supported("-std=c11")
        .warnings_into_errors(true)
        .compile("codex_canonical_sqlite_vfs");
}
