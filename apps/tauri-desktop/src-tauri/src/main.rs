use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::CommandEvent;
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
    let output_directory = normalize_output_directory(&registry, &file_path, input.output_directory)?;
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
    ).await?;
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
fn select_hwpx(app: AppHandle, registry: State<'_, Mutex<PathRegistry>>) -> Result<Option<String>, String> {
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
fn select_hwpx_many(app: AppHandle, registry: State<'_, Mutex<PathRegistry>>) -> Result<Option<Vec<String>>, String> {
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
        let normalized = normalize_existing_file(path.into_path().map_err(|error| error.to_string())?)?;
        register_input(&registry, &normalized)?;
        selected.push(normalized);
    }
    Ok(Some(selected))
}

#[tauri::command]
fn select_hwpx_folder(app: AppHandle, registry: State<'_, Mutex<PathRegistry>>) -> Result<Option<Value>, String> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = normalize_existing_dir(path.into_path().map_err(|error| error.to_string())?)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
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
fn select_directory(app: AppHandle, registry: State<'_, Mutex<PathRegistry>>) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = normalize_existing_dir(path.into_path().map_err(|error| error.to_string())?)?;
    register_output_dir(&registry, &directory)?;
    Ok(Some(directory))
}

#[tauri::command]
fn load_settings() -> Value {
    json!({
        "defaultMode": "balanced",
        "saveNextToOriginal": true,
        "saveReport": false,
        "preventOverwrite": true,
        "showAggressiveWarning": true,
        "submissionLimit": { "id": "mb20" },
        "preservationPreference": "recommended"
    })
}

#[tauri::command]
fn save_settings(patch: Value) -> Value {
    let mut settings = load_settings();
    if let (Some(base), Some(update)) = (settings.as_object_mut(), patch.as_object()) {
        for (key, value) in update {
            if key != "outputDirectory" {
                base.insert(key.clone(), value.clone());
            }
        }
    }
    settings
}

#[tauri::command]
fn cancel_analyze() -> Value {
    json!({ "ok": true, "cancelled": false, "reason": "not implemented in PoC" })
}

#[tauri::command]
fn cancel_optimize() -> Value {
    json!({ "ok": true, "cancelled": false, "reason": "not implemented in PoC" })
}

#[tauri::command]
fn save_batch_report(_input: Value) -> Result<Value, String> {
    Err("Batch report saving is outside the Tauri PoC scope.".into())
}

#[tauri::command]
fn preview_image_diffs(_input: Value) -> Result<Value, String> {
    Err("Image preview generation is outside the Tauri PoC scope.".into())
}

#[tauri::command]
fn show_item(_file_path: String) -> Result<Value, String> {
    Err("showItem is outside the Tauri PoC scope until generated-path allowlisting is ported.".into())
}

#[tauri::command]
fn open_path(_file_path: String) -> Result<Value, String> {
    Err("openPath is outside the Tauri PoC scope until generated-path allowlisting is ported.".into())
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
    let (mut rx, mut child) = sidecar_command
        .spawn()
        .map_err(|error| error.to_string())?;

    let request = SidecarRequest { id: 1, method, params };
    let request_line = format!(
        "{}\n",
        serde_json::to_string(&request).map_err(|error| error.to_string())?
    );
    child
        .write(request_line.as_bytes())
        .map_err(|error| error.to_string())?;

    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                let response: Value = serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
                let _ = child.kill();
                if response.get("ok").and_then(Value::as_bool) == Some(true) {
                    return Ok(response.get("result").cloned().unwrap_or(Value::Null));
                }
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
                return Err(format!("Sidecar terminated before response: {:?}; {}", payload, stderr));
            }
            _ => {}
        }
    }
    Err(format!("Sidecar ended without response. {}", stderr))
}

fn normalize_existing_file(path: PathBuf) -> Result<String, String> {
    if !is_hwpx_path(&path) {
        return Err("Only .hwpx files are supported by the Tauri PoC.".into());
    }
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

fn register_output_dir(registry: &State<'_, Mutex<PathRegistry>>, path: &str) -> Result<(), String> {
    let mut registry = registry.lock().map_err(|error| error.to_string())?;
    registry.output_dirs.insert(path.to_string());
    Ok(())
}

fn register_generated_output(registry: &State<'_, Mutex<PathRegistry>>, path: &str) -> Result<(), String> {
    let normalized = normalize_existing_file(PathBuf::from(path))?;
    register_input(registry, &normalized)
}

fn require_allowed_input(registry: &State<'_, Mutex<PathRegistry>>, path: &str) -> Result<String, String> {
    let normalized = normalize_existing_file(PathBuf::from(path))?;
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if registry.input_paths.contains(&normalized) {
        return Ok(normalized);
    }
    Err("File path was not selected in this Tauri session.".into())
}

fn require_allowed_generated_or_input(registry: &State<'_, Mutex<PathRegistry>>, path: &str) -> Result<String, String> {
    require_allowed_input(registry, path)
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

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(PathRegistry::default()))
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
            verify_hwpx,
            save_batch_report,
            preview_image_diffs,
            show_item,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
