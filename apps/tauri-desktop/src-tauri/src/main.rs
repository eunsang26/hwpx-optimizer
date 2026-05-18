use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeInput {
    file_path: String,
    mode: String,
    output_directory: Option<String>,
    actions: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct SidecarRequest<'a> {
    id: u64,
    method: &'a str,
    params: Value,
}

#[tauri::command]
fn sidecar_health() -> Result<Value, String> {
    call_sidecar("health", json!({}))
}

#[tauri::command]
fn analyze_hwpx(file_path: String) -> Result<Value, String> {
    call_sidecar("analyze", json!({ "filePath": file_path }))
}

#[tauri::command]
fn optimize_hwpx(input: OptimizeInput) -> Result<Value, String> {
    call_sidecar(
        "optimize",
        json!({
            "filePath": input.file_path,
            "mode": input.mode,
            "outputDirectory": input.output_directory,
            "actions": input.actions
        }),
    )
}

#[tauri::command]
fn verify_hwpx(file_path: String) -> Result<Value, String> {
    call_sidecar("verify", json!({ "filePath": file_path }))
}

#[tauri::command]
fn select_hwpx() -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
fn select_hwpx_many() -> Result<Option<Vec<String>>, String> {
    Ok(None)
}

#[tauri::command]
fn select_hwpx_folder() -> Result<Option<Value>, String> {
    Ok(None)
}

#[tauri::command]
fn select_directory() -> Result<Option<String>, String> {
    Ok(None)
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

fn call_sidecar(method: &str, params: Value) -> Result<Value, String> {
    let sidecar = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .with_file_name(sidecar_binary_name());
    let mut child = Command::new(sidecar)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let request = SidecarRequest { id: 1, method, params };
    {
        let stdin = child.stdin.as_mut().ok_or("Failed to open sidecar stdin.")?;
        writeln!(
            stdin,
            "{}",
            serde_json::to_string(&request).map_err(|error| error.to_string())?
        )
        .map_err(|error| error.to_string())?;
    }

    let stdout = child.stdout.take().ok_or("Failed to open sidecar stdout.")?;
    let mut lines = BufReader::new(stdout).lines();
    let line = lines
        .next()
        .ok_or("Sidecar did not return a response.")?
        .map_err(|error| error.to_string())?;
    let response: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Sidecar request failed.")
            .to_string())
    }
}

fn sidecar_binary_name() -> &'static str {
    if cfg!(windows) {
        "hwpx-sidecar.exe"
    } else {
        "hwpx-sidecar"
    }
}

fn main() {
    tauri::Builder::default()
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
