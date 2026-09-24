#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Location of the JSON file holding lists, tasks and UI preferences.
struct Store(PathBuf);

#[tauri::command]
fn load_state(store: State<Store>) -> Option<Value> {
    let text = fs::read_to_string(&store.0).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
fn save_state(store: State<Store>, state: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash mid-write never truncates the data file.
    let tmp = store.0.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &store.0).map_err(|e| e.to_string())
}

/// Pin the window above every other window, on every Space, including
/// other apps' full-screen Spaces.
#[tauri::command]
fn set_pinned(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        window
            .run_on_main_thread(move || macos::apply_pin(&w, pinned))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hiding the Dock icon (accessory activation policy) is what lets the
/// window float over another app's full-screen Space.
#[tauri::command]
fn set_dock_hidden(app: AppHandle, hidden: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let policy = if hidden {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        };
        app.set_activation_policy(policy)
            .map_err(|e| e.to_string())?;
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, hidden);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    use tauri::WebviewWindow;

    /// NSStatusWindowLevel: above normal and floating windows (incl. other
    /// apps' always-on-top panels), below menus and the screen saver.
    const STATUS_LEVEL: isize = 25;
    const NORMAL_LEVEL: isize = 0;

    pub fn apply_pin(window: &WebviewWindow, pinned: bool) {
        let Ok(ptr) = window.ns_window() else { return };
        // SAFETY: Tauri returns the live NSWindow backing this webview window,
        // and we are on the main thread (run_on_main_thread).
        let ns = unsafe { &*(ptr as *const NSWindow) };
        let extra = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        let mut behavior = ns.collectionBehavior();
        if pinned {
            behavior |= extra;
            behavior &= !NSWindowCollectionBehavior::MoveToActiveSpace;
        } else {
            behavior &= !extra;
        }
        ns.setCollectionBehavior(behavior);
        ns.setLevel(if pinned { STATUS_LEVEL } else { NORMAL_LEVEL });
    }
}

/// Launch at login via a per-user LaunchAgent. Enabling re-registers the
/// current executable path, so calling it again after moving the app is safe.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store(dir.join("todos.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            set_pinned,
            set_dock_hidden,
            set_autostart,
            get_autostart
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskTodo");
}
