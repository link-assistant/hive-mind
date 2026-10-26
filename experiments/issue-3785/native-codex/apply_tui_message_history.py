#!/usr/bin/env python3
"""Gate real native TUI prompt dispatch on canonical history publication."""
import hashlib
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != "6aaac694803004a63c6f393d153c96d22521a6b9":
    raise SystemExit("Refusing unpinned native source.")
base = root / "codex-rs"
expected = {
    "tui/src/app_event.rs": "419bddca75f564d007095d0f0d9b18eeb230b741d4a8bd163ff0570748f6f024",
    "tui/src/chatwidget.rs": "b1e83988bb7d9513f2b53aacf77b41e522e039cd9582c9f52ea91235c1e484c1",
    "tui/src/chatwidget/input_submission.rs": "4b6b774dab131dd5c9c3861c7ec59955d4137addc91b530d2f8266b53363eec1",
    "tui/src/app/event_dispatch.rs": "dd058511034eb4f531736d0bea05aaedc8b4d8f34a47609f8fc87d6ef3043600",
    "message-history/src/lib.rs": "c1a813e5c90ffac5a13e412f963e236dec2801b940e29a1ce1d3d7cb60e71afd",
}
sources = {}
for relative, digest in expected.items():
    sources[relative] = (base / relative).read_text()
    if hashlib.sha256(sources[relative].encode()).hexdigest() != digest:
        raise SystemExit("Refusing changed native TUI/history source; no files changed.")


def replace(target, before, after):
    if sources[target].count(before) != 1:
        raise SystemExit("Ambiguous native TUI context; no files changed.")
    sources[target] = sources[target].replace(before, after, 1)


replace("message-history/src/lib.rs", "fn history_filepath(config: &HistoryConfig) -> PathBuf {", '''/// Admit selected canonical history without adding a row for an image-only prompt.
pub async fn validate_canonical_history(config: &HistoryConfig) -> Result<()> {
    if !canonical_message_history::selected() {
        return Ok(());
    }
    if !matches!(config.persistence, HistoryPersistence::SaveAll)
        || config.max_bytes.is_some_and(|limit| limit > 0)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Canonical prompt history requires complete persistence.",
        ));
    }
    let path = history_filepath(config);
    tokio::task::spawn_blocking(move || {
        canonical_message_history::with_history(&path, |_| Ok(()))
    }).await??;
    Ok(())
}

fn history_filepath(config: &HistoryConfig) -> PathBuf {''')
replace("tui/src/app_event.rs", "    CodexOp(AppCommand),", '''    CodexOp(AppCommand),

    /// Publish prompt history before forwarding this turn to the app server.
    CanonicalPrompt {
        thread_id: ThreadId,
        op: AppCommand,
        text: Option<String>,
    },''')
replace("tui/src/chatwidget.rs", '''        let op: AppCommand = op.into();
        if self.rejects_misalignment_policy_op(&op) {''', '''        self.submit_op_with_canonical_history(op.into(), None)
    }

    fn submit_prompt_op(&mut self, op: AppCommand, text: Option<String>) -> bool {
        let history = std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").map(|_| text);
        self.submit_op_with_canonical_history(op, history)
    }

    fn submit_op_with_canonical_history(
        &mut self,
        op: AppCommand,
        canonical_history: Option<Option<String>>,
    ) -> bool {
        if canonical_history.is_some()
            && (!matches!(&self.codex_op_target, CodexOpTarget::AppEvent)
                || self.thread_id.is_none())
        {
            self.add_error_message("Canonical prompt history requires an active app-server thread.".into());
            return false;
        }
        if std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").is_some()
            && matches!(&op, AppCommand::UserTurn { .. })
            && canonical_history.is_none()
        {
            self.add_error_message("Canonical prompt history is required before submitting a turn.".into());
            return false;
        }
        if self.rejects_misalignment_policy_op(&op) {''')
replace("tui/src/chatwidget.rs", '''                self.app_event_tx.send(AppEvent::CodexOp(op));''', '''                if let Some(text) = canonical_history {
                    self.app_event_tx.send(AppEvent::CanonicalPrompt {
                        thread_id: self.thread_id.expect("canonical history admission checked thread"),
                        op,
                        text,
                    });
                } else {
                    self.app_event_tx.send(AppEvent::CodexOp(op));
                }''')
# Compute exactly the same native mention-aware history text before queuing the
# turn, then send text and operation in one event. Legacy persistence stays async.
input_file = "tui/src/chatwidget/input_submission.rs"
start = sources[input_file].index("        // Persist the submitted text to cross-session message history.")
end = sources[input_file].index("\n        if let Some(pending_steer) = pending_steer {", start)
history = sources[input_file][start:end]
old_tail = '''        if let Some((text, elements)) = history {
            let reply_text = crate::async_question_reply::display_text(text);
            let (text, elements) = match &reply_text {
                Some(text) => (text.as_str(), &[][..]),
                None => (text.as_str(), elements),
            };
            self.append_message_history_entry(encode_history_mentions_at_elements(
                text,
                &encoded_mentions,
                elements,
            ));
        }
'''
new_tail = '''        let history_text = history.map(|(text, elements)| {
            let reply_text = crate::async_question_reply::display_text(text);
            let (text, elements) = match &reply_text {
                Some(text) => (text.as_str(), &[][..]),
                None => (text.as_str(), elements),
            };
            encode_history_mentions_at_elements(text, &encoded_mentions, elements)
        });
'''
if history.count(old_tail) != 1:
    raise SystemExit("Ambiguous native mention encoding; no files changed.")
computed = history.replace(old_tail, new_tail)
sources[input_file] = sources[input_file][:start] + '''        if std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").is_none()
            && let Some(text) = history_text
        {
            self.append_message_history_entry(text);
        }
''' + sources[input_file][end:]
replace(input_file, "        if !self.submit_op(op.clone()) {", computed + "\n        if !self.submit_prompt_op(op.clone(), history_text.clone()) {")
# Normalize the compound event after offline admission. The existing exhaustive
# command handler continues to own permission checks, deferred turns and errors.
replace("tui/src/app/event_dispatch.rs", "        match event {\n            AppEvent::OpenDaemonMenu", '''        let event = match event {
            AppEvent::CanonicalPrompt { thread_id, op, text } => {
                if self.active_thread_id != Some(thread_id)
                    || self.chat_widget.thread_id() != Some(thread_id)
                    || self.thread_unavailable(thread_id)
                {
                    return Err(anyhow::anyhow!("Canonical prompt history requires the active writable thread."));
                }
                let history_config = codex_message_history::HistoryConfig::new(
                    self.local_settings.codex_home.clone(),
                    &self.local_settings.history,
                );
                let result = if let Some(text) = text {
                    codex_message_history::append_entry(&text, thread_id, &history_config).await
                } else {
                    codex_message_history::validate_canonical_history(&history_config).await
                };
                if result.is_err() {
                    return Err(anyhow::anyhow!("Canonical prompt history is unavailable; no turn was sent."));
                }
                AppEvent::CodexOp(op)
            }
            event => event,
        };
        match event {
            AppEvent::CanonicalPrompt { .. } => unreachable!("canonical prompt normalized before dispatch"),
            AppEvent::OpenDaemonMenu''')
for relative, source in sources.items():
    sources[relative] = subprocess.run(
        ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
        input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical TUI publication patch is applicable; no files changed.")
else:
    for relative, source in sources.items():
        (base / relative).write_text(source)
    print("Applied canonical TUI prompt publication experiment; production is unchanged.")
