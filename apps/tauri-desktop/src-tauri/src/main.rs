use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, AppHandle};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

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
async fn sidecar_health(app: AppHandle) -> Result<Value, String> {
    call_sidecar(app, "health", json!({})).await
}

#[tauri::command]
async fn analyze_hwpx(app: AppHandle, file_path: String) -> Result<Value, String> {
    call_sidecar(app, "analyze", json!({ "filePath": file_path })).await
}

#[tauri::command]
async fn optimize_hwpx(app: AppHandle, input: OptimizeInput) -> Result<Value, String> {
    call_sidecar(
        app,
        "optimize",
        json!({
            "filePath": input.file_path,
            "mode": input.mode,
            "outputDirectory": input.output_directory,
            "actions": input.actions
        }),
    ).await
}

#[tauri::command]
async fn verify_hwpx(app: AppHandle, file_path: String) -> Result<Value, String> {
    call_sidecar(app, "verify", json!({ "filePath": file_path })).await
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
