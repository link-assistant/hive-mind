//! File-reading agentic recipe for local workspace prompts (issue #627).

mod audit;
mod exact;
mod supplied;

use audit::file_read_final_answer;
pub use supplied::supplied_file_answer;

use serde_json::json;

use super::file_path_shape::{is_dotted_number, peel_sentence_punctuation};
use super::general_planner::has_file_write_intent;
use super::planner::{tool_capability, AgenticPlan, Capability, PlannedToolCall};
use super::shell_command_policy::sentences;
use super::write_request;
use crate::protocol::{ChatMessage, ToolCall};
use crate::seed;

const AUDIT_READ_LINE_LIMIT: usize = 160;
const AUDIT_READ_COLUMN_LIMIT: usize = 320;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum FileReadTask {
    Direct {
        path: String,
        mode: FileReadMode,
        prefer_run: bool,
    },
    DirectMany {
        paths: Vec<String>,
        mode: FileReadMode,
    },
    ListThenRead {
        directory: String,
        selection: FileSelection,
        mode: FileReadMode,
    },
}

impl FileReadTask {
    pub(super) fn is_analysis(&self) -> bool {
        match self {
            Self::Direct { mode, .. }
            | Self::DirectMany { mode, .. }
            | Self::ListThenRead { mode, .. } => mode == &FileReadMode::Audit,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum FileReadMode {
    Full,
    FirstLine,
    ExtractValue(String),
    Summary,
    /// Collect explicit incompleteness evidence without loading whole files.
    Audit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FileSelection {
    First,
    Last,
    All,
}

struct ToolResultRecord {
    capability: Option<Capability>,
    arguments: serde_json::Value,
    content: String,
}

/// The issue-#627 file-reading recipe: direct filename requests use an advertised
/// `read` tool, shell-shaped `cat` requests use the run tool, and multi-step
/// "list then read" prompts walk `bash(ls)` → `read(file)` → final content.
pub(super) fn plan_file_read_step(
    task: &FileReadTask,
    messages: &[ChatMessage],
    tool_names: &[&str],
) -> AgenticPlan {
    let read_tool = tool_for(tool_names, Capability::Read);
    let run_tool = tool_for(tool_names, Capability::Run);
    let grep_tool = tool_for(tool_names, Capability::Grep);
    let records = tool_result_records(messages);
    let request = crate::protocol::latest_user_request(messages).unwrap_or_default();

    match task {
        FileReadTask::Direct {
            path,
            mode,
            prefer_run,
        } => plan_direct_file_read(
            path,
            mode,
            *prefer_run,
            read_tool,
            run_tool,
            grep_tool,
            &records,
            &request,
        ),
        FileReadTask::DirectMany { paths, mode } => {
            exact::plan_direct_file_reads(
                paths,
                mode,
                read_tool,
                run_tool,
                grep_tool,
                &records,
                &request,
            )
        }
        FileReadTask::ListThenRead {
            directory,
            selection,
            mode,
        } => plan_list_then_read(
            directory, *selection, mode, read_tool, run_tool, &records, &request,
        ),
    }
}

/// The report for a recorded step the harness itself judged failed (rung
/// `R916-01`).
///
/// A read whose command exited non-zero has no contents to show: issue #905
/// watched `cat hello.txt` exit 1 and still be answered with "Contents of
/// `hello.txt`:" wrapped around the transport envelope, so the missing file read
/// as an empty one. The report is the seed-localized one every other route
/// uses, so the request's own language answers it.
fn failed_step_answer(label: &str, raw: &str, request: &str) -> Option<String> {
    super::tool_result::harness_reported_failure(raw)
        .then(|| super::tool_result::render(label, raw, request))
}

// The eight parameters are the read plan's own slots (path, mode, tool
// availability, prior records, request); bundling them would invent a struct
// only this planner reads.
#[allow(clippy::too_many_arguments)]
fn plan_direct_file_read(
    path: &str,
    mode: &FileReadMode,
    prefer_run: bool,
    read_tool: Option<&str>,
    run_tool: Option<&str>,
    grep_tool: Option<&str>,
    records: &[ToolResultRecord],
    request: &str,
) -> AgenticPlan {
    if mode == &FileReadMode::Audit {
        return exact::plan_direct_file_reads(
            &[path.to_owned()],
            mode,
            read_tool,
            run_tool,
            grep_tool,
            records,
            request,
        );
    }
    let read_command = read_command_for(path, mode);
    let exact_run = exact::exact_line_key(request).is_some() && run_tool.is_some();
    let recorded = if exact_run {
        run_record_for_command(records, &read_command).map(|raw| {
            (
                read_command.as_str(),
                raw,
                super::tool_result::strip_transport_envelope(raw),
            )
        })
    } else {
        read_result_for_path(records, path)
            .map(|raw| (path, raw, raw.to_owned()))
            .or_else(|| {
                run_record_for_command(records, &read_command).map(|raw| {
                    (
                        read_command.as_str(),
                        raw,
                        super::tool_result::strip_transport_envelope(raw),
                    )
                })
            })
    };
    if let Some((label, raw, content)) = recorded {
        if let Some(failure) = failed_step_answer(label, raw, request) {
            return AgenticPlan::Final(failure);
        }
        let content = if label == path {
            super::code_artifact::source_from_read_result(&content)
        } else {
            content
        };
        return AgenticPlan::Final(file_read_final_answer(
            mode,
            &[(path.to_owned(), content)],
            request,
        ));
    }

    if (prefer_run || exact_run)
        && let Some(tool) = run_tool {
            return plan_one(
                tool,
                json!({ "command": read_command_for(path, mode) }).to_string(),
            );
        }

    if let Some(tool) = read_tool {
        return plan_one(tool, read_arguments(path, mode));
    }
    if let Some(tool) = run_tool {
        return plan_one(
            tool,
            json!({ "command": read_command_for(path, mode) }).to_string(),
        );
    }

    AgenticPlan::Final(format!(
        "I can read `{path}` when the client advertises a file read tool or a shell tool."
    ))
}

fn plan_list_then_read(
    directory: &str,
    selection: FileSelection,
    mode: &FileReadMode,
    read_tool: Option<&str>,
    run_tool: Option<&str>,
    records: &[ToolResultRecord],
    request: &str,
) -> AgenticPlan {
    let list_command = list_files_command(directory);
    let Some(raw_listing) = run_record_for_command(records, &list_command) else {
        if let Some(tool) = run_tool {
            return plan_one(tool, json!({ "command": list_command }).to_string());
        }
        return AgenticPlan::Final(
            "I can resolve that file selection when the client advertises a shell tool for listing files."
                .to_owned(),
        );
    };
    if let Some(failure) = failed_step_answer(&list_command, raw_listing, request) {
        return AgenticPlan::Final(failure);
    }
    let listing = super::tool_result::strip_transport_envelope(raw_listing);

    let paths = selected_paths_from_listing(directory, &listing, selection);
    if paths.is_empty() {
        return AgenticPlan::Final(format!("No files were listed in `{directory}`."));
    }

    if let Some(contents) = read_results_for_paths(records, &paths) {
        if let Some(failure) = contents
            .iter()
            .find_map(|(path, raw)| failed_step_answer(path, raw, request))
        {
            return AgenticPlan::Final(failure);
        }
        return AgenticPlan::Final(file_read_final_answer(mode, &contents, request));
    }

    if selection == FileSelection::All {
        if let Some(tool) = read_tool {
            let calls = paths
                .iter()
                .filter(|path| read_result_for_path(records, path).is_none())
                .map(|path| PlannedToolCall {
                    tool: tool.to_owned(),
                    arguments: read_arguments(path, mode),
                })
                .collect();
            return AgenticPlan::ToolCalls(calls);
        }
    } else if let Some(path) = paths.first()
        && let Some(tool) = read_tool {
            return plan_one(tool, read_arguments(path, mode));
        }

    if let Some(tool) = run_tool {
        let command = if selection == FileSelection::All {
            cat_many_command(&paths)
        } else {
            read_command_for(&paths[0], mode)
        };
        if let Some(raw) = run_record_for_command(records, &command) {
            if let Some(failure) = failed_step_answer(&command, raw, request) {
                return AgenticPlan::Final(failure);
            }
            return AgenticPlan::Final(file_read_final_answer(
                mode,
                &[(
                    paths.join(", "),
                    super::tool_result::strip_transport_envelope(raw),
                )],
                request,
            ));
        }
        return plan_one(tool, json!({ "command": command }).to_string());
    }

    AgenticPlan::Final(
        "I can read the selected file after listing when the client advertises a read or shell tool."
            .to_owned(),
    )
}

pub(super) fn file_read_task_for(prompt: &str) -> Option<FileReadTask> {
    let lower = prompt.to_lowercase();

    // Issue #681: a file-creation / write request must never be routed to the read
    // recipe — the target does not exist yet, so reading it is always the wrong
    // tool. When the request is a write intent, decline here and let the router
    // fall through to the general write/create planner. This is the general rule
    // ("write intent beats read intent"), not a per-phrase special case: the same
    // gate catches create/write/save/generate across every supported language.
    if has_file_write_intent(&lower) {
        return None;
    }

    if let Some(path) = leading_cat_path(prompt) {
        return Some(FileReadTask::Direct {
            path,
            mode: FileReadMode::Full,
            prefer_run: false,
        });
    }

    if asks_to_read_every_file(&lower) {
        return Some(FileReadTask::ListThenRead {
            directory: String::from("."),
            selection: FileSelection::All,
            mode: FileReadMode::Summary,
        });
    }

    if asks_to_list_then_read(&lower) {
        return Some(FileReadTask::ListThenRead {
            directory: directory_for_list_read(prompt).unwrap_or_else(|| String::from(".")),
            selection: selection_for_prompt(&lower),
            mode: mode_for_prompt(prompt),
        });
    }

    if asks_to_read_file_in_folder(&lower) {
        return Some(FileReadTask::ListThenRead {
            directory: directory_for_list_read(prompt).unwrap_or_else(|| String::from(".")),
            selection: FileSelection::First,
            mode: mode_for_prompt(prompt),
        });
    }

    // A read cue and a path in the same sentence are about each other, and that
    // is the ordinary case: "выведи sample.txt", "show me the contents of
    // beta.md". Answering it from the sentence rather than from the whole prompt
    // is what keeps the two-obligation requests below from being decided by a
    // cue that belongs to a different clause (issue #1066).
    let read_paths = read_paths_named_beside_their_cue(prompt);
    if read_paths.len() > 1 {
        return Some(FileReadTask::DirectMany {
            paths: read_paths,
            mode: mode_for_prompt(prompt),
        });
    }
    if let Some(path) = read_paths.into_iter().next() {
        return Some(FileReadTask::Direct {
            path,
            mode: mode_for_prompt(prompt),
            prefer_run: false,
        });
    }

    // Issue #1066: "write intent beats read intent" is decided above over the
    // whole prompt, which settles a request that is only a write. It does not
    // settle a request that is both -- "find X out, and leave the answer in
    // FILE" -- because there the read cue and the path belong to different
    // sentences and different obligations. "Leave observable evidence in
    // `.agent-ladder/node-1.2-proof.md`. The first line must be exactly
    // `node_path=1.2`" carries the read cue *first line* in the sentence that
    // constrains the file's opening, and the only path in the prompt is the one
    // the caller asked to have written. Opening it reads a file that does not
    // exist yet, and the run ends by recording the resulting error as its
    // evidence. Where cue and path were never in one sentence, a path the
    // request states as a write destination is therefore not a read target.
    if has_file_read_intent(&lower)
        && let Some(path) = first_local_file_path(prompt)
        && !write_request::is_stated_write_target(prompt, &path)
    {
        return Some(FileReadTask::Direct {
            path,
            mode: mode_for_prompt(prompt),
            prefer_run: false,
        });
    }

    None
}

/// The first path a request names in the same sentence as a read cue.
///
/// Sentence scope is what separates a cue that is *about* the path from one that
/// merely shares a prompt with it, the same scoping
/// [`super::evidence_record`] uses to split a delivery obligation from the work
/// it delivers, and [`super::shell_command`] uses to tell a named command from an
/// ordered one (issue #907).
fn read_paths_named_beside_their_cue(prompt: &str) -> Vec<String> {
    sentences(prompt)
        .into_iter()
        .find_map(|sentence| {
            has_file_read_intent(&sentence.text.to_lowercase())
                .then(|| local_file_paths(sentence.text))
        })
        .unwrap_or_default()
}

fn has_file_read_intent(lower: &str) -> bool {
    seed::lexicon().mentions_role(seed::ROLE_FILE_READ_ACTION_CUE, lower)
}

fn asks_to_read_every_file(lower: &str) -> bool {
    (lower.contains("read every file") || lower.contains("read all files"))
        && (lower.contains("summarize") || lower.contains("summary") || lower.contains("here"))
}

fn asks_to_list_then_read(lower: &str) -> bool {
    let lists_files = lower.contains("list the files")
        || lower.contains("list files")
        || lower.contains("ls the folder")
        || lower.contains("ls ");
    let reads_after = lower.contains("read")
        || lower.contains("contents")
        || lower.contains("content")
        || lower.contains("show me");
    lists_files && reads_after
}

fn asks_to_read_file_in_folder(lower: &str) -> bool {
    lower.contains("read the file") && (lower.contains(" folder") || lower.contains(" directory"))
}

fn selection_for_prompt(lower: &str) -> FileSelection {
    if lower.contains("last") {
        FileSelection::Last
    } else {
        FileSelection::First
    }
}

fn mode_for_prompt(prompt: &str) -> FileReadMode {
    // Inspection verbs are multilingual seed data, so normalization must fold
    // every script that has case rather than only ASCII. Otherwise a capitalized
    // Russian imperative misses the same semantic role its lowercase form hits.
    let lower = prompt.to_lowercase();
    if lower.contains("first line") {
        return FileReadMode::FirstLine;
    }
    if let Some(key) = extract_value_key(prompt) {
        return FileReadMode::ExtractValue(key);
    }
    if let Some(key) = exact::exact_line_key(prompt) {
        return FileReadMode::ExtractValue(key);
    }
    if seed::lexicon().mentions_role(seed::ROLE_WORKSPACE_INSPECTION_ACTION, &lower) {
        return FileReadMode::Audit;
    }
    if lower.contains("summarize") || lower.contains("summary") {
        return FileReadMode::Summary;
    }
    FileReadMode::Full
}

fn extract_value_key(prompt: &str) -> Option<String> {
    let lower = prompt.to_ascii_lowercase();
    let marker = "value of ";
    let start = lower.find(marker)? + marker.len();
    let rest = &prompt[start..];
    let key = rest
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|c: char| !is_file_path_char(c));
    (!key.is_empty()).then(|| key.to_owned())
}

fn leading_cat_path(prompt: &str) -> Option<String> {
    let trimmed = prompt.trim().trim_matches('`').trim();
    let mut parts = trimmed.split_whitespace();
    let command = parts.next()?;
    if !command.eq_ignore_ascii_case("cat") {
        return None;
    }
    parts
        .next()
        .map(clean_file_token)
        .filter(|path| !path.is_empty())
}

fn first_local_file_path(prompt: &str) -> Option<String> {
    local_file_paths(prompt).into_iter().next()
}

fn local_file_paths(prompt: &str) -> Vec<String> {
    let mut paths = prompt
        .split_whitespace()
        .map(clean_file_token)
        .filter(|token| looks_like_local_file_path(token))
        .collect::<Vec<_>>();
    paths.dedup();
    paths
}

/// A path token as prose wrote it, stripped of the punctuation the sentence put
/// around it.
///
/// The terminating dot is delegated to
/// [`trim_trailing_sentence_dot`](super::file_path_shape::trim_trailing_sentence_dot)
/// so the read route, the write-request parser and the shell route all draw the
/// same boundary between a path and the sentence carrying it.
fn clean_file_token(token: &str) -> String {
    peel_sentence_punctuation(token, |token| {
        token
            .trim_matches('`')
            .trim_matches('"')
            .trim_matches('\'')
            .trim_matches(|c: char| {
                matches!(
                    c,
                    ',' | ';' | ':' | '!' | '?' | ')' | '(' | '[' | ']' | '{' | '}'
                )
            })
    })
    .to_owned()
}

fn looks_like_local_file_path(token: &str) -> bool {
    if token.is_empty()
        || token.contains("://")
        || token.starts_with("http:")
        || token.starts_with("https:")
        || is_dotted_number(token)
    {
        return false;
    }
    if token.contains('/') {
        return token.chars().all(is_file_path_char);
    }
    let Some((stem, extension)) = token.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && !extension.is_empty()
        && extension.len() <= 12
        && token.chars().all(is_file_path_char)
}

const fn is_file_path_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '/' | '\\' | '@')
}

fn directory_for_list_read(prompt: &str) -> Option<String> {
    let tokens = prompt
        .split_whitespace()
        .map(clean_file_token)
        .collect::<Vec<_>>();
    for window in tokens.windows(3) {
        if window[0].eq_ignore_ascii_case("the")
            && !window[1].is_empty()
            && (window[2].eq_ignore_ascii_case("folder")
                || window[2].eq_ignore_ascii_case("directory"))
        {
            return Some(window[1].clone());
        }
        if (window[0].eq_ignore_ascii_case("in") || window[0].eq_ignore_ascii_case("inside"))
            && window[1].eq_ignore_ascii_case("the")
            && !window[2].is_empty()
        {
            return Some(window[2].clone());
        }
    }
    for window in tokens.windows(2) {
        let lower = window[0].to_ascii_lowercase();
        if !window[0].is_empty()
            && (window[1].eq_ignore_ascii_case("folder")
                || window[1].eq_ignore_ascii_case("directory"))
            && !["the", "a", "this", "current"].contains(&lower.as_str())
        {
            return Some(window[0].clone());
        }
    }
    None
}

fn tool_result_records(messages: &[ChatMessage]) -> Vec<ToolResultRecord> {
    // Only results produced *within the current user turn* ground a read. A
    // client loops tool calls without a new user message, so the current turn is
    // everything after the last user message; a `cat 1.txt` result from an
    // earlier turn must never be replayed as the answer to a later `read 1.txt`
    // (issue #755 — read/list determinism). Without this bound the recipe short
    // -circuits on a stale, unrelated result and skips the fresh read entirely.
    let turn_start = messages
        .iter()
        .rposition(|message| message.role.eq_ignore_ascii_case("user"))
        .map_or(0, |index| index + 1);
    let mut records = Vec::new();
    for (index, message) in messages.iter().enumerate().skip(turn_start) {
        if !message.role.eq_ignore_ascii_case("tool") {
            continue;
        }
        let (capability, arguments) =
            tool_result_call(messages, index).map_or((None, serde_json::Value::Null), |call| {
                (
                    tool_capability(&call.function.name),
                    serde_json::from_str(&call.function.arguments)
                        .unwrap_or(serde_json::Value::Null),
                )
            });
        records.push(ToolResultRecord {
            capability,
            arguments,
            content: message.content.plain_text(),
        });
    }
    records
}

fn tool_result_call(messages: &[ChatMessage], index: usize) -> Option<&ToolCall> {
    let call_id = messages[index].tool_call_id.as_ref()?;
    messages[..index]
        .iter()
        .flat_map(|prior| prior.tool_calls.iter())
        .find(|call| &call.id == call_id)
}

fn read_result_for_path<'a>(records: &'a [ToolResultRecord], path: &str) -> Option<&'a str> {
    records
        .iter()
        .find(|record| {
            record.capability == Some(Capability::Read)
                && path_argument(&record.arguments)
                    .is_some_and(|recorded| same_path(&recorded, path))
        })
        .map(|record| record.content.as_str())
}

fn grep_result_for_path<'a>(
    records: &'a [ToolResultRecord],
    path: &str,
    pattern: &str,
) -> Option<&'a str> {
    records
        .iter()
        .find(|record| {
            record.capability == Some(Capability::Grep)
                && path_argument(&record.arguments)
                    .is_some_and(|recorded| same_path(&recorded, path))
                && record
                    .arguments
                    .get("pattern")
                    .and_then(serde_json::Value::as_str)
                    == Some(pattern)
        })
        .map(|record| record.content.as_str())
}

/// Whether a recorded path argument denotes the path the planner asked for.
///
/// The transcript holds the argument the *client's* schema accepted, not the one
/// the planner planned with: [`crate::protocol_responses`] rewrites `path` to
/// Gemini's `absolute_path` and absolutises it, so a recorded
/// `/work/alpha.txt` has to answer a planned `alpha.txt`.
fn same_path(recorded: &str, planned: &str) -> bool {
    if recorded == planned {
        return true;
    }
    let planned = planned.trim_start_matches("./");
    recorded
        .trim_start_matches("./")
        .strip_suffix(planned)
        .is_some_and(|prefix| prefix.is_empty() || prefix.ends_with('/'))
}

fn read_results_for_paths(
    records: &[ToolResultRecord],
    paths: &[String],
) -> Option<Vec<(String, String)>> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let content = read_result_for_path(records, path)?;
        out.push((path.clone(), content.to_owned()));
    }
    Some(out)
}

/// The recorded run result for `command`, exactly as the harness reported it.
///
/// Callers that only want the command's own text strip the transport envelope
/// themselves; callers that have to judge whether the step *succeeded* need the
/// envelope intact, because the `Exit Code:` field is what it carries (rung
/// `R916-01`).
fn run_record_for_command<'a>(records: &'a [ToolResultRecord], command: &str) -> Option<&'a str> {
    records
        .iter()
        .find(|record| {
            record.capability == Some(Capability::Run)
                && command_argument(&record.arguments) == Some(command)
        })
        .map(|record| record.content.as_str())
}

/// The shell command a recorded run call carried.
///
/// Codex advertises `exec_command(cmd)`, so [`crate::protocol_responses`]
/// projects the planner's `command` argument onto `cmd` before it reaches the
/// client — and the transcript then plays that projected form back. Reading the
/// record under `command` alone never matched, so the planner could not see its
/// own completed `cat` and re-planned the identical call on every round
/// (issue #671).
fn command_argument(arguments: &serde_json::Value) -> Option<&str> {
    ["command", "cmd"]
        .iter()
        .find_map(|key| arguments.get(*key).and_then(serde_json::Value::as_str))
}

fn path_argument(arguments: &serde_json::Value) -> Option<String> {
    ["filePath", "path", "file_path", "absolute_path"]
        .iter()
        .find_map(|key| arguments.get(*key).and_then(serde_json::Value::as_str))
        .map(ToOwned::to_owned)
}

fn read_arguments(path: &str, mode: &FileReadMode) -> String {
    let mut arguments = json!({
        "filePath": path,
        "path": path,
        "file_path": path,
    });
    if mode == &FileReadMode::Audit {
        arguments["offset"] = json!(0);
        arguments["limit"] = json!(AUDIT_READ_LINE_LIMIT);
        arguments["columnOffset"] = json!(0);
        arguments["columnLimit"] = json!(AUDIT_READ_COLUMN_LIMIT);
    }
    arguments.to_string()
}

fn grep_arguments(path: &str, pattern: &str) -> String {
    json!({ "path": path, "pattern": pattern }).to_string()
}

/// Build the audit query from semantic seed data. The one structural member is
/// an unchecked Markdown box: syntax rather than natural-language domain data.
fn file_analysis_pattern() -> String {
    let mut alternatives = vec![String::from(r"\[\s*\]")];
    alternatives.extend(
        seed::lexicon()
            .words_for_role(seed::ROLE_FILE_ANALYSIS_GAP_MARKER)
            .into_iter()
            .filter(|surface| !surface.trim().is_empty())
            .map(|surface| regex_escape(&surface)),
    );
    alternatives.sort();
    alternatives.dedup();
    format!("(?i)(?:{})", alternatives.join("|"))
}

fn regex_escape(surface: &str) -> String {
    surface
        .chars()
        .flat_map(|character| {
            if matches!(
                character,
                '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
                    | '\\'
            ) {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect()
}

fn read_command_for(path: &str, mode: &FileReadMode) -> String {
    match mode {
        FileReadMode::FirstLine => format!("head -n 1 {}", shell_path(path)),
        FileReadMode::ExtractValue(key) => {
            let expression = shell_string(&format!("s/^{key}=//p"));
            ["sed", "-n", &expression, &shell_path(path)].join(" ")
        }
        FileReadMode::Audit => {
            let line_range = format!("'1,{AUDIT_READ_LINE_LIMIT}p'");
            let column_range = format!("1-{AUDIT_READ_COLUMN_LIMIT}");
            [
                "sed",
                "-n",
                &line_range,
                &shell_path(path),
                "|",
                "cut",
                "-c",
                &column_range,
            ]
            .join(" ")
        }
        FileReadMode::Full | FileReadMode::Summary => {
            format!("cat {}", shell_path(path))
        }
    }
}

fn list_files_command(directory: &str) -> String {
    if directory == "." {
        String::from("find . -maxdepth 1 -type f | sed 's#^./##' | sort")
    } else {
        format!(
            "find {} -maxdepth 1 -type f | sed 's#^.*/##' | sort",
            shell_path(directory)
        )
    }
}

fn cat_many_command(paths: &[String]) -> String {
    paths
        .iter()
        .map(|path| {
            format!(
                "printf '==> %s <==\\n' {}; cat {}",
                shell_path(path),
                shell_path(path)
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn shell_path(path: &str) -> String {
    if path.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '/')
    }) {
        path.to_owned()
    } else {
        format!("'{}'", path.replace('\'', "'\\''"))
    }
}

fn shell_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn selected_paths_from_listing(
    directory: &str,
    listing: &str,
    selection: FileSelection,
) -> Vec<String> {
    let mut entries = listing
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.trim_start_matches("./").to_owned())
        .collect::<Vec<_>>();
    entries.sort();
    entries.dedup();

    let selected = match selection {
        FileSelection::First => entries.into_iter().take(1).collect(),
        FileSelection::Last => entries.into_iter().rev().take(1).collect(),
        FileSelection::All => entries,
    };

    selected
        .into_iter()
        .map(|entry: String| {
            if directory == "." || entry.contains('/') {
                entry
            } else {
                format!("{directory}/{entry}")
            }
        })
        .collect()
}

fn tool_for<'a>(tool_names: &[&'a str], capability: Capability) -> Option<&'a str> {
    tool_names
        .iter()
        .copied()
        .find(|name| tool_capability(name) == Some(capability))
}

fn plan_one(tool: &str, arguments: String) -> AgenticPlan {
    AgenticPlan::ToolCalls(vec![PlannedToolCall {
        tool: tool.to_owned(),
        arguments,
    }])
}
