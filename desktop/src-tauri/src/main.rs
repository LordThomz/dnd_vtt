// Verhindert ein zusätzliches Konsolenfenster unter Windows im Release-Build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Hält den laufenden Server-Prozess samt seiner Prozess-ID (PID),
/// damit wir ihn beim Beenden zuverlässig stoppen können.
struct ServerProcess {
    child: Mutex<Option<CommandChild>>,
    pid: Mutex<Option<u32>>,
}

/// Beendet den Server-Prozess UND alle seine Kind-Prozesse.
///
/// Wichtig: Der gebündelte Server (PyInstaller Ein-Datei) startet beim Start
/// einen zweiten, inneren Prozess. Ein einfaches kill() auf den äußeren würde
/// den inneren weiterlaufen lassen. Deshalb beenden wir den ganzen Prozessbaum.
fn kill_server(state: &ServerProcess) {
    // Zuerst den von Tauri verwalteten Prozess sauber beenden.
    let child_opt = { state.child.lock().unwrap().take() };
    if let Some(child) = child_opt {
        let _ = child.kill();
    }
    // Dann sicherstellen, dass auch der innere Prozessbaum weg ist.
    let pid_opt = { *state.pid.lock().unwrap() };
    if let Some(pid) = pid_opt {
        #[cfg(target_os = "windows")]
        {
            // /T = mitsamt Kind-Prozessen, /F = erzwingen
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW – kein Fenster-Aufblitzen
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("pkill")
                .args(["-TERM", "-P", &pid.to_string()])
                .spawn();
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .spawn();
        }
    }
    // Zur Sicherheit unter Windows: alle übrig gebliebenen vtt-server-Prozesse beenden.
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/IM", "vtt-server-x86_64-pc-windows-msvc.exe", "/T", "/F"])
            .creation_flags(0x08000000)
            .spawn();
        let _ = std::process::Command::new("taskkill")
            .args(["/IM", "vtt-server.exe", "/T", "/F"])
            .creation_flags(0x08000000)
            .spawn();
    }
}

// Nötig für creation_flags unter Windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Vom Launcher aufgerufen, BEVOR ein Update installiert wird: Unter Windows
/// kann der Installer die Server-Datei sonst nicht ersetzen (sie ist in Benutzung).
#[tauri::command]
fn stop_server(state: tauri::State<'_, ServerProcess>) {
    kill_server(&state);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![stop_server])
        .manage(ServerProcess {
            child: Mutex::new(None),
            pid: Mutex::new(None),
        })
        .setup(|app| {
            // Wenn eine entfernte Server-Adresse gesetzt ist, KEINEN lokalen
            // Server starten – die App verbindet sich dann zum echten Server.
            if std::env::var("VTT_REMOTE").is_ok() {
                println!("[VTT] VTT_REMOTE gesetzt – kein lokaler Server.");
                return Ok(());
            }

            // Bevor wir starten: eventuell noch laufende alte Server beenden,
            // damit sich nichts stapelt (falls ein früherer nicht sauber zuging).
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/IM", "vtt-server-x86_64-pc-windows-msvc.exe", "/T", "/F"])
                    .creation_flags(0x08000000)
                    .spawn();
            }

            // Den mitgelieferten, gebündelten Server ("Sidecar") starten.
            let sidecar = app
                .shell()
                .sidecar("vtt-server")
                .expect("Server-Sidecar 'vtt-server' nicht gefunden")
                .env("VTT_OPEN_BROWSER", "false");

            match sidecar.spawn() {
                Ok((_rx, child)) => {
                    let pid = child.pid();
                    println!("[VTT] Gebündelter Server gestartet (PID {pid}).");
                    let state = app.state::<ServerProcess>();
                    *state.child.lock().unwrap() = Some(child);
                    *state.pid.lock().unwrap() = Some(pid);
                }
                Err(e) => {
                    eprintln!("[VTT] Konnte Server nicht starten: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Beim Schließen des Fensters den Server (und Kind-Prozesse) beenden.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<ServerProcess>();
                kill_server(&state);
                println!("[VTT] Server beendet.");
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der D&D Virtual Tabletop App");
}
