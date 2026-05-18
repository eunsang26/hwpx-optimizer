use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeInput {
    file_path: String,
    mode: String,
    output_directory: Option<String>,
    output_mode: Option<String>,
    actions: Option<Vec<String>>,
}

#[derive(Default)]
struct PathRegistry {
    input_paths: HashSet<String>,
    output_dirs: HashSet<String>,
    generated_paths: HashSet<String>,
    dropped_input_paths: Vec<String>,
}

#[derive(Default)]
struct ActiveSidecar {
    active_child: Option<(u32, CommandChild)>,
    cancelled_pids: HashSet<u32>,
}

#[derive(Debug, Serialize)]
struct SidecarRequest<'a> {
    id: u64,
    method: &'a str,
    params: Value,
}

#[tauri::command]
async fn sidecar_health(app: AppHandle) -> Result<Value, String> {
    call_sidecar(app, "health", json!({})).await
}

#[tauri::command]
async fn analyze_hwpx(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
    file_path: String,
) -> Result<Value, String> {
    let file_path = require_allowed_input(&registry, &file_path)?;
    call_sidecar(app, "analyze", json!({ "filePath": file_path })).await
}

#[tauri::command]
async fn optimize_hwpx(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
    input: OptimizeInput,
) -> Result<Value, String> {
    let file_path = require_allowed_input(&registry, &input.file_path)?;
    let output_directory =
        normalize_output_directory(&registry, &file_path, input.output_directory)?;
    let result = call_sidecar(
        app,
        "optimize",
        json!({
            "filePath": file_path,
            "mode": input.mode,
            "outputDirectory": output_directory,
            "outputMode": input.output_mode,
            "actions": input.actions
        }),
    )
    .await?;
    if let Some(output_path) = result.get("outputPath").and_then(Value::as_str) {
        register_generated_output(&registry, output_path)?;
    }
    Ok(result)
}

#[tauri::command]
async fn verify_hwpx(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
    file_path: String,
) -> Result<Value, String> {
    let file_path = require_allowed_generated_or_input(&registry, &file_path)?;
    call_sidecar(app, "verify", json!({ "filePath": file_path })).await
}

#[tauri::command]
fn select_hwpx(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("HWPX documents", &["hwpx"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let selected = normalize_existing_file(path.into_path().map_err(|error| error.to_string())?)?;
    register_input(&registry, &selected)?;
    Ok(Some(selected))
}

#[tauri::command]
fn select_hwpx_many(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
) -> Result<Option<Vec<String>>, String> {
    let Some(paths) = app
        .dialog()
        .file()
        .add_filter("HWPX documents", &["hwpx"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    let mut selected = Vec::new();
    for path in paths {
        let normalized =
            normalize_existing_file(path.into_path().map_err(|error| error.to_string())?)?;
        register_input(&registry, &normalized)?;
        selected.push(normalized);
    }
    Ok(Some(selected))
}

#[tauri::command]
fn select_hwpx_folder(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
) -> Result<Option<Value>, String> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = normalize_existing_dir(path.into_path().map_err(|error| error.to_string())?)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let path = entry.path();
        if !is_hwpx_path(&path) {
            continue;
        }
        let normalized = normalize_existing_file(path)?;
        register_input(&registry, &normalized)?;
        files.push(normalized);
    }
    Ok(Some(json!({ "directory": directory, "files": files })))
}

#[tauri::command]
fn select_directory(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = normalize_existing_dir(path.into_path().map_err(|error| error.to_string())?)?;
    register_output_dir(&registry, &directory)?;
    Ok(Some(directory))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Value, String> {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, patch: Value) -> Result<Value, String> {
    let mut settings = read_settings(&app)?;
    apply_settings_patch(&mut settings, patch);
    write_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn cancel_analyze(active: State<'_, Mutex<ActiveSidecar>>) -> Result<Value, String> {
    cancel_active_sidecar(active)
}

#[tauri::command]
fn cancel_optimize(active: State<'_, Mutex<ActiveSidecar>>) -> Result<Value, String> {
    cancel_active_sidecar(active)
}

#[tauri::command]
fn consume_dropped_hwpx_files(
    registry: State<'_, Mutex<PathRegistry>>,
) -> Result<Vec<String>, String> {
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut registry.dropped_input_paths))
}

#[tauri::command]
async fn save_batch_report(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
    input: Value,
) -> Result<Value, String> {
    let first_input_path = input
        .get("firstInputPath")
        .and_then(Value::as_str)
        .ok_or("Expected firstInputPath for batch report.")?;
    let first_input_path = require_allowed_input(&registry, first_input_path)?;
    let output_directory = match input.get("outputDirectory").and_then(Value::as_str) {
        Some(output_directory) => normalize_output_directory(
            &registry,
            &first_input_path,
            Some(output_directory.to_string()),
        )?
        .ok_or("Failed to resolve selected batch report output directory.")?,
        None => Path::new(&first_input_path)
            .parent()
            .ok_or("Selected input path has no parent directory.")?
            .to_str()
            .ok_or("Path is not valid UTF-8.")?
            .to_string(),
    };
    let report_directory = Path::new(&output_directory)
        .join("output")
        .to_str()
        .ok_or("Path is not valid UTF-8.")?
        .to_string();
    let mode = input
        .get("mode")
        .and_then(Value::as_str)
        .ok_or("Expected mode for batch report.")?;
    let items = validate_batch_report_items(
        &registry,
        input.get("items").cloned().unwrap_or(Value::Null),
    )?;
    let result = call_sidecar(
        app.clone(),
        "saveBatchReport",
        json!({
            "reportDirectory": report_directory,
            "mode": mode,
            "settings": read_settings(&app)?,
            "items": items
        }),
    )
    .await?;
    if let Some(report_path) = result.get("reportPath").and_then(Value::as_str) {
        register_generated_artifact(&registry, report_path)?;
    }
    Ok(result)
}

#[tauri::command]
async fn preview_image_diffs(
    app: AppHandle,
    registry: State<'_, Mutex<PathRegistry>>,
    input: Value,
) -> Result<Value, String> {
    let original_path = input
        .get("originalPath")
        .and_then(Value::as_str)
        .ok_or("Expected originalPath for image preview.")?;
    let optimized_path = input
        .get("optimizedPath")
        .and_then(Value::as_str)
        .ok_or("Expected optimizedPath for image preview.")?;
    let original_path = require_allowed_input(&registry, original_path)?;
    let optimized_path = require_allowed_generated_path(&registry, optimized_path)?;
    call_sidecar(
        app,
        "previewImageDiffs",
        json!({
            "originalPath": original_path,
            "optimizedPath": optimized_path,
            "maxItems": input.get("maxItems").cloned(),
            "maxInputBytes": input.get("maxInputBytes").cloned()
        }),
    )
    .await
}

#[tauri::command]
fn show_item(registry: State<'_, Mutex<PathRegistry>>, file_path: String) -> Result<Value, String> {
    let file_path = require_allowed_generated_path(&registry, &file_path)?;
    reveal_path(&file_path)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn open_path(registry: State<'_, Mutex<PathRegistry>>, file_path: String) -> Result<Value, String> {
    let file_path = require_allowed_generated_path(&registry, &file_path)?;
    open_generated_path(&file_path)?;
    Ok(json!({ "ok": true }))
}

async fn call_sidecar(app: AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let sidecar_entry = app
        .path()
        .resolve("sidecar/index.js", tauri::path::BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    let sidecar_entry_arg = sidecar_entry
        .to_str()
        .ok_or("Failed to convert sidecar entry path to UTF-8.")?
        .to_string();
    let sidecar_command = app
        .shell()
        .sidecar("hwpx-sidecar")
        .map_err(|error| error.to_string())?
        .args([sidecar_entry_arg]);
    let (mut rx, mut child) = sidecar_command.spawn().map_err(|error| error.to_string())?;
    let pid = child.pid();

    let request = SidecarRequest {
        id: 1,
        method,
        params,
    };
    let request_line = format!(
        "{}\n",
        serde_json::to_string(&request).map_err(|error| error.to_string())?
    );
    child
        .write(request_line.as_bytes())
        .map_err(|error| error.to_string())?;
    {
        let active = app.state::<Mutex<ActiveSidecar>>();
        let mut active = active.lock().map_err(|error| error.to_string())?;
        if active.active_child.is_some() {
            let _ = child.kill();
            return Err("Another sidecar operation is already running.".into());
        }
        active.active_child = Some((pid, child));
    }

    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                let response: Value =
                    serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
                if response.get("event").and_then(Value::as_str) == Some("progress") {
                    if let Some(progress) = response.get("progress") {
                        app.emit("hwpx:optimize-progress", progress.clone())
                            .map_err(|error| error.to_string())?;
                    }
                    continue;
                }
                if response.get("ok").and_then(Value::as_bool) == Some(true) {
                    let _ = finish_active_sidecar(&app, pid, true);
                    return Ok(response.get("result").cloned().unwrap_or(Value::Null));
                }
                let _ = finish_active_sidecar(&app, pid, true);
                return Err(response
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Sidecar request failed.")
                    .to_string());
            }
            CommandEvent::Stderr(line_bytes) => {
                stderr.push_str(&String::from_utf8_lossy(&line_bytes));
            }
            CommandEvent::Terminated(payload) => {
                let _ = finish_active_sidecar(&app, pid, false);
                if take_cancelled_pid(&app, pid)? {
                    return Err("Operation cancelled.".into());
                }
                return Err(format!(
                    "Sidecar terminated before response: {:?}; {}",
                    payload, stderr
                ));
            }
            _ => {}
        }
    }
    let _ = finish_active_sidecar(&app, pid, false);
    if take_cancelled_pid(&app, pid)? {
        return Err("Operation cancelled.".into());
    }
    Err(format!("Sidecar ended without response. {}", stderr))
}

fn normalize_existing_file(path: PathBuf) -> Result<String, String> {
    if !is_hwpx_path(&path) {
        return Err("Only .hwpx files are supported by the Tauri PoC.".into());
    }
    normalize_existing_artifact(path)
}

fn normalize_existing_artifact(path: PathBuf) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("Expected a file path: {}", path.display()));
    }
    normalize_path(path)
}

fn normalize_existing_dir(path: PathBuf) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err(format!("Expected a directory path: {}", path.display()));
    }
    normalize_path(path)
}

fn normalize_path(path: PathBuf) -> Result<String, String> {
    path.canonicalize()
        .map_err(|error| error.to_string())?
        .to_str()
        .ok_or("Path is not valid UTF-8.".to_string())
        .map(ToString::to_string)
}

fn is_hwpx_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("hwpx"))
}

fn register_input(registry: &State<'_, Mutex<PathRegistry>>, path: &str) -> Result<(), String> {
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.input_paths.insert(path.to_string());
    Ok(())
}

fn register_dropped_hwpx_paths(
    registry: &Mutex<PathRegistry>,
    paths: &[PathBuf],
) -> Result<(), String> {
    let mut dropped = Vec::new();
    for path in paths {
        if !is_hwpx_path(path) {
            continue;
        }
        if let Ok(normalized) = normalize_existing_file(path.to_path_buf()) {
            dropped.push(normalized);
        }
    }
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.dropped_input_paths = dropped.clone();
    for path in dropped {
        registry.input_paths.insert(path);
    }
    Ok(())
}

fn register_output_dir(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<(), String> {
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.output_dirs.insert(path.to_string());
    Ok(())
}

fn register_generated_output(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_existing_file(PathBuf::from(path))?;
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.generated_paths.insert(normalized);
    Ok(())
}

fn register_generated_artifact(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_existing_artifact(PathBuf::from(path))?;
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.generated_paths.insert(normalized);
    Ok(())
}

fn require_allowed_input(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<String, String> {
    let normalized = normalize_existing_file(PathBuf::from(path))?;
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if registry.input_paths.contains(&normalized) {
        return Ok(normalized);
    }
    Err("File path was not selected in this Tauri session.".into())
}

fn require_allowed_generated_or_input(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<String, String> {
    let normalized = normalize_existing_file(PathBuf::from(path))?;
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if registry.input_paths.contains(&normalized) || registry.generated_paths.contains(&normalized)
    {
        return Ok(normalized);
    }
    Err("File path was not selected or generated in this Tauri session.".into())
}

fn require_allowed_generated_path(
    registry: &State<'_, Mutex<PathRegistry>>,
    path: &str,
) -> Result<String, String> {
    let normalized = normalize_existing_artifact(PathBuf::from(path))?;
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if registry.generated_paths.contains(&normalized) {
        return Ok(normalized);
    }
    Err("File path was not generated in this Tauri session.".into())
}

fn validate_batch_report_items(
    registry: &State<'_, Mutex<PathRegistry>>,
    items: Value,
) -> Result<Vec<Value>, String> {
    let items = items.as_array().ok_or("Expected batch report items.")?;
    let mut sanitized = Vec::with_capacity(items.len());
    for item in items {
        let object = item
            .as_object()
            .ok_or("Expected batch report item object.")?;
        let input = object
            .get("input")
            .and_then(Value::as_str)
            .ok_or("Expected batch report item input.")?;
        let status = object
            .get("status")
            .and_then(Value::as_str)
            .ok_or("Expected batch report item status.")?;
        if status != "done" && status != "failed" && status != "cancelled" {
            return Err(format!("Invalid batch report item status: {}", status));
        }
        let mut next = object.clone();
        next.insert(
            "input".into(),
            Value::String(require_allowed_input(registry, input)?),
        );
        if let Some(output) = object.get("output").and_then(Value::as_str) {
            next.insert(
                "output".into(),
                Value::String(require_allowed_generated_path(registry, output)?),
            );
        }
        if let Some(report) = object.get("report").and_then(Value::as_str) {
            next.insert(
                "report".into(),
                Value::String(require_allowed_generated_path(registry, report)?),
            );
        }
        sanitized.push(Value::Object(next));
    }
    Ok(sanitized)
}

fn normalize_output_directory(
    registry: &State<'_, Mutex<PathRegistry>>,
    input_path: &str,
    output_directory: Option<String>,
) -> Result<Option<String>, String> {
    let Some(output_directory) = output_directory else {
        return Ok(None);
    };
    let normalized = normalize_existing_dir(PathBuf::from(output_directory))?;
    let input_parent = Path::new(input_path)
        .parent()
        .ok_or("Selected input path has no parent directory.")?;
    let input_parent = normalize_existing_dir(input_parent.to_path_buf())?;
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if registry.output_dirs.contains(&normalized) || normalized == input_parent {
        return Ok(Some(normalized));
    }
    Err("Output directory was not selected in this Tauri session.".into())
}

fn default_settings() -> Value {
    json!({
        "settingsVersion": 2,
        "defaultMode": "balanced",
        "saveNextToOriginal": true,
        "saveReport": false,
        "preventOverwrite": true,
        "showAggressiveWarning": true,
        "submissionLimit": { "id": "mb20" },
        "preservationPreference": "recommended"
    })
}

fn read_settings(app: &AppHandle) -> Result<Value, String> {
    let path = settings_path(app)?;
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(default_settings());
    };
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let mut settings = default_settings();
    apply_settings_patch(&mut settings, parsed);
    Ok(settings)
}

fn write_settings(app: &AppHandle, settings: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json"))
}

fn apply_settings_patch(settings: &mut Value, patch: Value) {
    let Some(base) = settings.as_object_mut() else {
        return;
    };
    let Some(update) = patch.as_object() else {
        return;
    };
    if matches!(
        update.get("defaultMode").and_then(Value::as_str),
        Some("safe" | "balanced" | "aggressive")
    ) {
        base.insert("defaultMode".into(), update["defaultMode"].clone());
    }
    if update.get("saveNextToOriginal").and_then(Value::as_bool) == Some(true) {
        base.insert("saveNextToOriginal".into(), Value::Bool(true));
    }
    for key in ["saveReport", "preventOverwrite", "showAggressiveWarning"] {
        if let Some(value) = update.get(key).and_then(Value::as_bool) {
            base.insert(key.into(), Value::Bool(value));
        }
    }
    if is_submission_limit(update.get("submissionLimit")) {
        base.insert("submissionLimit".into(), update["submissionLimit"].clone());
    }
    if matches!(
        update.get("preservationPreference").and_then(Value::as_str),
        Some("preserve" | "recommended" | "size")
    ) {
        base.insert(
            "preservationPreference".into(),
            update["preservationPreference"].clone(),
        );
    }
}

fn is_submission_limit(value: Option<&Value>) -> bool {
    let Some(value) = value.and_then(Value::as_object) else {
        return false;
    };
    let Some(id) = value.get("id").and_then(Value::as_str) else {
        return false;
    };
    if id != "none" && id != "mb10" && id != "mb20" && id != "mb50" && id != "custom" {
        return false;
    }
    value.get("customBytes").is_none_or(Value::is_number)
}

fn reveal_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", path))
        .status();
    #[cfg(target_os = "macos")]
    let status = Command::new("open").args(["-R", path]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(Path::new(path).parent().unwrap_or_else(|| Path::new(path)))
        .status();
    status.map_err(|error| error.to_string())?;
    Ok(())
}

fn open_generated_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", path]).status();
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status();
    status.map_err(|error| error.to_string())?;
    Ok(())
}

fn cancel_active_sidecar(active: State<'_, Mutex<ActiveSidecar>>) -> Result<Value, String> {
    let mut active = active.lock().map_err(|error| error.to_string())?;
    let Some((pid, child)) = active.active_child.take() else {
        return Ok(json!({ "ok": true, "cancelled": false }));
    };
    active.cancelled_pids.insert(pid);
    child.kill().map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "cancelled": true }))
}

fn finish_active_sidecar(app: &AppHandle, pid: u32, kill: bool) -> Result<(), String> {
    let active = app.state::<Mutex<ActiveSidecar>>();
    let mut active = active.lock().map_err(|error| error.to_string())?;
    let Some((active_pid, child)) = active.active_child.take() else {
        return Ok(());
    };
    if active_pid == pid {
        if kill {
            let _ = child.kill();
        }
        return Ok(());
    }
    active.active_child = Some((active_pid, child));
    Ok(())
}

fn take_cancelled_pid(app: &AppHandle, pid: u32) -> Result<bool, String> {
    let active = app.state::<Mutex<ActiveSidecar>>();
    let mut active = active.lock().map_err(|error| error.to_string())?;
    Ok(active.cancelled_pids.remove(&pid))
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(PathRegistry::default()))
        .manage(Mutex::new(ActiveSidecar::default()))
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let registry = webview.app_handle().state::<Mutex<PathRegistry>>();
                let _ = register_dropped_hwpx_paths(&registry, paths);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            sidecar_health,
            select_hwpx,
            select_hwpx_many,
            select_hwpx_folder,
            select_directory,
            load_settings,
            save_settings,
            analyze_hwpx,
            optimize_hwpx,
            cancel_analyze,
            cancel_optimize,
            consume_dropped_hwpx_files,
            verify_hwpx,
            save_batch_report,
            preview_image_diffs,
            show_item,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
